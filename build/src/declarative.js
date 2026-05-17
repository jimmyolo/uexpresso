const acorn = require("acorn");
const { stringify } = require("./utils.js");
const uWS = require("@jimmyolo/uws.js");
const statuses = require("statuses");

const parser = acorn.Parser;

const allowedResMethods = new Set(['set', 'header', 'setHeader', 'status', 'sendStatus', 'send', 'end', 'append']);
const allowedIdentifiers = new Set(['query', 'params', ...allowedResMethods]);
const disallowedTokens = new Set(['throw', 'new', 'await', 'return', 'try', 'catch', 'finally', 'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'var', 'let', 'const']);

const objKeyRegex = /[\s{\n]([A-Za-z-0-9_]+)(\s|\n)*?:/g;

function replaceSingleCharacter(str, index, char) {
    return str.slice(0, index) + char + str.slice(index + 1);
}

function findHeaderIndex(headers, name) {
    const lowerCasedName = name.toLowerCase();
    return headers.findIndex(header => header[0].toLowerCase() === lowerCasedName);
}

function hasHeader(headers, name) {
    return findHeaderIndex(headers, name) !== -1;
}

function getHeaderValue(headers, name) {
    const index = findHeaderIndex(headers, name);
    return index === -1 ? undefined : headers[index][1];
}

function setHeaderValue(headers, name, value) {
    const index = findHeaderIndex(headers, name);
    if(index === -1) {
        headers.push([name, value]);
    } else {
        headers[index][1] = value;
    }
}

function removeHeader(headers, name) {
    const index = findHeaderIndex(headers, name);
    if(index !== -1) {
        headers.splice(index, 1);
    }
}

// generates a declarative response from a callback
// uWS allows creating such responses and they are extremely fast
// since you don't even have to call into Node.js at all
// declarative response will only be created if callback is 'simple enough'
// simple enough means:
// - doesnt call external functions
// - doesnt create variables
// - only uses req.query and req.params
// basically, its only simple, static responses
module.exports = function compileDeclarative(cb, app) {
    try {
        let code = cb.toString();
        // convert anonymous functions to named ones to make it valid code
        if(code.startsWith("function") || code.startsWith("async function")) {
            code = code.replace(/function *\(/, "function __cb(");
        }

        for (const token of acorn.tokenizer(code, { ecmaVersion: "latest" })) {
            if (disallowedTokens.has(token.value)) return false;
        }

        const parsed = parser.parse(code, { ecmaVersion: "latest" }).body;
        let fn = parsed[0];

        if(fn.type === 'ExpressionStatement') {
            fn = fn.expression;
        }

        // check if it is a function
        if(fn.type !== 'FunctionDeclaration' && fn.type !== 'ArrowFunctionExpression') {
            return false;
        }

        const args = fn.params.map(param => param.name);

        if(args.length < 2) {
            // invalid function? doesn't have (req, res) args
            return false;
        }

        const [req, res] = args;
        let queryName, paramsName, queries = new Set(), params = new Set();

        if(fn.params[0].type === 'ObjectPattern') {
            let query = fn.params[0].properties.find(prop => prop.key.name === 'query');
            let param = fn.params[0].properties.find(prop => prop.key.name === 'params');

            if(query?.value?.type === 'Identifier') {
                queryName = query.value.name;
            } else if(query?.value?.type === 'ObjectPattern') {
                for(let prop of query.value.properties) {
                    if(prop.value.type !== 'Identifier') {
                        return false;
                    }
                    queries.add(prop.value.name);
                }
            } else {
                return false;
            }

            if(param?.value?.type === 'Identifier') {
                paramsName = param.value.name;
            } else if(param?.value?.type === 'ObjectPattern') {
                for(let prop of param.value.properties) {
                    if(prop.value.type !== 'Identifier') {
                        return false;
                    }
                    params.add(prop.value.name);
                }
            } else {
                return false;
            }
        }

        // collect both CallExpression and Identifier nodes in a single AST walk
        const callExprs = [], identifierNodes = [];
        collectNodes(fn, callExprs, identifierNodes);

        // check if it calls any other function other than the one in `res`
        const resCalls = [];
        for(let expr of callExprs) {
            let calleeName, propertyName;

            
            // get propertyName
            if(expr.type === 'MemberExpression') {
                propertyName = expr.property.name;
            } else if(expr.type === 'CallExpression') {
                propertyName = expr.callee?.property?.name ?? expr.callee?.name;
            }

            // get calleeName
            switch(expr.callee.type) {
                case "Identifier":
                    calleeName = expr.callee.name;
                    break;
                case "MemberExpression":
                    if(expr.callee.object.type === 'Identifier') {
                        calleeName = expr.callee.object.name;
                    } else if(expr.callee.object.type === 'CallExpression') {
                        // function call chaining
                        let callee = expr.callee;
                        while(callee.object.callee) {
                            callee = callee.object.callee;
                        }
                        if(callee.object.type !== 'Identifier') {
                            return false;
                        }
                        calleeName = callee.object.name;
                    }
                    break;
                default:
                    return false;
            }
            // check if calleeName is res
            if(calleeName !== res) {
                return false;
            }

            if(!allowedResMethods.has(propertyName)) {
                return false;
            }

            const obj = { calleeName, propertyName };
            expr.obj = obj;
            resCalls.push(obj);
        }

        // check if all identifiers are allowed
        const identifiers = identifierNodes.slice(args.length).map(id => id.name);
        if(identifiers[identifiers.length - 1] === '__cb') {
            identifiers.pop();
        }
        if(!identifiers.every((id, i) =>
            allowedIdentifiers.has(id) ||
            id === req ||
            id === res ||
            (identifiers[i - 2] === req && identifiers[i - 1] === 'params') ||
            (identifiers[i - 2] === req && identifiers[i - 1] === 'query') ||
            id === queryName ||
            id === paramsName ||
            queries.has(id) ||
            params.has(id)
        )) {
            return false;
        }

        
        let statusCode = 200;
        const headers = [];
        const body = [];
        let sendStatusUsed = false;

        // get statusCode + headers (merged pass)
        for(let call of callExprs) {
            const prop = call.obj.propertyName;
            if(prop === 'status') {
                if(call.arguments[0].type !== 'Literal') return false;
                statusCode = call.arguments[0].value;
            } else if(prop === 'header' || prop === 'setHeader' || prop === 'set') {
                if(call.arguments[0].type !== 'Literal' || call.arguments[1].type !== 'Literal') {
                    return false;
                }
                const sameHeader = headers.find(header => header[0].toLowerCase() === call.arguments[0].value.toLowerCase());
                let [header, value] = [call.arguments[0].value, call.arguments[1].value];
                if(prop !== 'setHeader' && value.includes('text/') && !value.includes('; charset=')) {
                    value += '; charset=utf-8';
                }
                if(sameHeader) {
                    sameHeader[1] = value;
                } else {
                    headers.push([header, value]);
                }
            } else if(prop === 'append') {
                if(call.arguments[0].type !== 'Literal' || call.arguments[1].type !== 'Literal') {
                    return false;
                }
                headers.push([call.arguments[0].value, call.arguments[1].value]);
            } else if(prop === 'sendStatus') {
                if(call.arguments[0].type !== 'Literal') return false;
                statusCode = call.arguments[0].value;
                sendStatusUsed = true;
                setHeaderValue(headers, 'content-type', 'text/plain; charset=utf-8');
            }
        }

        // get body
        let sendUsed = false;
        for(let call of callExprs) {
            if(call.obj.propertyName === 'send' || call.obj.propertyName === 'end') {
                if(sendUsed) {
                    return false;
                }
                if(call.obj.propertyName === 'send') {
                    const contentType = getHeaderValue(headers, 'content-type');
                    if(typeof contentType === 'undefined') {
                        setHeaderValue(headers, 'content-type', 'text/html; charset=utf-8');
                    } else if(contentType.includes('text/') && !contentType.includes('; charset=')) {
                        setHeaderValue(headers, 'content-type', `${contentType}; charset=utf-8`);
                    }
                }
                const arg = call.arguments[0];
                if(arg) {
                    if(arg.type === 'Literal') {
                        if(typeof arg.value === 'number') { // status code
                            return false;
                        }
                        let val = arg.value;
                        if(val === null) {
                            val = '';
                            removeHeader(headers, 'content-type');
                        }
                        if(typeof val === 'boolean') {
                            setHeaderValue(headers, 'content-type', 'application/json; charset=utf-8');
                        }
                        body.push({type: 'text', value: val});
                    } else if(arg.type === 'TemplateLiteral') {
                        const exprs = [...arg.quasis, ...arg.expressions].sort((a, b) => a.start - b.start);
                        for(let expr of exprs) {
                            if(expr.type === 'TemplateElement') {
                                body.push({type: 'text', value: expr.value.cooked});
                            } else if(expr.type === 'MemberExpression') {
                                const obj = expr.object;
                                let type;
                                if(obj.type === 'MemberExpression') {
                                    if(obj.property.type !== 'Identifier') {
                                        return false;
                                    }
                                    type = obj.property.name;
                                } else if(obj.type === 'Identifier') {
                                    type = obj.name;
                                } else {
                                    return false;
                                }
                                if(type !== 'params' && type !== 'query') {
                                    return false;
                                }
                                body.push({type, value: expr.property.name});
                            } else if(expr.type === 'Identifier') {
                                if(queries.has(expr.name)) {
                                    body.push({ type: 'query', value: expr.name });
                                } else if(params.has(expr.name)) {
                                    body.push({ type: 'params', value: expr.name });
                                } else {
                                    return false;
                                }
                            } else {
                                return false;
                            }
                        }
                    } else if(arg.type === 'MemberExpression') {
                        if(!arg.object.property) {
                            return false;
                        }
                        if(arg.object.property.type !== 'Identifier' || (arg.object.property.name !== 'query' && arg.object.property.name !== 'params')) {
                            return false;
                        }
                        body.push({type: arg.object.property.name, value: arg.property.name});
                    } else if(arg.type === 'BinaryExpression') {
                        let stuff = [];
                        function check(node) {
                            if(node.right.type === 'Literal') {
                                stuff.push({type: 'text', value: node.right.value});
                            } else if(node.right.type === 'MemberExpression')  {
                                stuff.push({type: node.right.object.property.name, value: node.right.property.name});
                            } else return false;
                            if(node.left.type === 'Literal') {
                                stuff.push({type: 'text', value: node.left.value});
                            } else if(node.left.type === 'MemberExpression') {
                                stuff.push({type: node.left.object.property.name, value: node.left.property.name});
                            } else if(node.left.type === 'BinaryExpression') {
                                return check(node.left);
                            } else return false;

                            return true;
                        }
                        if(!check(arg)) {
                            return false;
                        }
                        body.push(...stuff.reverse());
                    } else if(arg.type === 'ObjectExpression') {
                        if(call.obj.propertyName === 'end') {
                            return false;
                        }
                        // only simple objects can be optimized
                        let objCode = code;
                        for(let property of arg.properties) {
                            if(property.key.type !== 'Identifier' && property.key.type !== 'Literal') {
                                return false;
                            }
                            if(property.value.raw.startsWith("'") && property.value.raw.endsWith("'") && !property.value.value.includes("'")) {
                                objCode = replaceSingleCharacter(objCode, property.value.start, '"');
                                objCode = replaceSingleCharacter(objCode, property.value.end - 1, '"');
                            }
                            if(property.value.type !== 'Literal') {
                                return false;
                            }
                        }
                        if(typeof app.get('json replacer') !== 'undefined' && typeof app.get('json replacer') !== 'string') {
                            return false;
                        }

                        setHeaderValue(headers, 'content-type', 'application/json; charset=utf-8');
                        body.push({
                            type: 'text',
                            value:
                                stringify(
                                    JSON.parse(objCode.slice(arg.start, arg.end).replace(objKeyRegex, '"$1":')),
                                    app.get('json replacer'),
                                    app.get('json spaces'),
                                    app.get('json escape')
                                )
                        });
                    } else {
                        return false;
                    }
                }
                sendUsed = true;
            }
        }

        if(sendStatusUsed) {
            if(sendUsed) {
                return false;
            }
            body.push({type: 'text', value: statuses.message[statusCode] || String(statusCode)});
            sendUsed = true;
        }

        if(!sendUsed) {
            return false;
        }

        let decRes = new uWS.DeclarativeResponse();

        if(statusCode != 200) {
            const statusMessage = statuses.message[statusCode] ?? '';
            decRes.writeStatus(`${statusCode} ${statusMessage}`.trim());
            if(!hasHeader(headers, 'content-type')) {
                decRes.writeHeader('content-type', 'text/plain; charset=utf-8');
            }
        }

        for(let header of headers) {
            if(header[0].toLowerCase() === 'content-length') {
                return false;
            }
            decRes.writeHeader(header[0], header[1]);
        }

        if(app.get('etag') && !hasHeader(headers, 'etag')) {
            if(body.some(part => part.type !== 'text')) {
                return false;
            } else {
                decRes.writeHeader('ETag', app.get('etag fn')(body.map(part => part.value.toString()).join('')));
            }
        }

        if(app.get('x-powered-by') && !hasHeader(headers, 'x-powered-by')) {
            decRes.writeHeader('x-powered-by', 'u-expresso');
        }

        for(let bodyPart of body) {
            if(bodyPart.type === 'text' && String(bodyPart.value).length) {
                decRes.write(String(bodyPart.value));
            } else if(bodyPart.type === 'params') {
                decRes.writeParameterValue(bodyPart.value);
            } else if(bodyPart.type === 'query') {
                decRes.writeQueryValue(bodyPart.value);
            }
        }

        return decRes.end();
    } catch(e) {
        return false;
    }
}

function collectNodes(node, callAcc, idAcc) {
    if(node.type === 'CallExpression') callAcc.push(node);
    else if(node.type === 'Identifier') idAcc.push(node);

    if(node.params) {
        for(const param of node.params) collectNodes(param, callAcc, idAcc);
    }
    if(node.body) {
        if(Array.isArray(node.body)) {
            for(const child of node.body) collectNodes(child, callAcc, idAcc);
        } else {
            collectNodes(node.body, callAcc, idAcc);
        }
    }
    if(node.declarations) {
        for(const declaration of node.declarations) collectNodes(declaration, callAcc, idAcc);
    }
    if(node.expression) collectNodes(node.expression, callAcc, idAcc);
    if(node.callee)     collectNodes(node.callee, callAcc, idAcc);
    if(node.object)     collectNodes(node.object, callAcc, idAcc);
    if(node.property)   collectNodes(node.property, callAcc, idAcc);
    if(node.id)         collectNodes(node.id, callAcc, idAcc);
    if(node.init)       collectNodes(node.init, callAcc, idAcc);
    if(node.left)       collectNodes(node.left, callAcc, idAcc);
    if(node.right)      collectNodes(node.right, callAcc, idAcc);
    if(node.arguments) {
        for(const argument of node.arguments) collectNodes(argument, callAcc, idAcc);
    }
}
