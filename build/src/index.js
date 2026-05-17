















const uWS = require("@jimmyolo/uws.js");
const Application = require("./application.js");
const Router = require("./router.js");
const middlewares = require("./middlewares.js");
const Request = require("./request.js");
const Response = require("./response.js");

try {
    // disable uWebSockets header
    uWS._cfg('999999990007');
} catch(error) { }

// converts router to a function and makes it callable
Application.Router = function (options) {
    const router = new Router(options);
    const fn = function (req, res, next) {
        router._routeRequest(req, res, 0).then(routed => {
            if(!routed) {
                next();
            }
        });
    };
    Object.assign(fn, router);
    Object.setPrototypeOf(fn, Object.getPrototypeOf(router));
    return fn;
}

Application.request = Request.prototype;
Application.response = Response.prototype;

Application.static = middlewares.static;

Application.json = middlewares.json;
Application.urlencoded = middlewares.urlencoded;
Application.text = middlewares.text;
Application.raw = middlewares.raw;

// 先設置 module.exports
module.exports = Application;

// 然後手動添加所有屬性到 module.exports 上（不使用 exports.xxx）
module.exports.default = Application;
module.exports.application = Application;
module.exports.request = Request.prototype;
module.exports.response = Response.prototype;
module.exports.Router = Application.Router;
module.exports.json = middlewares.json;
module.exports.raw = middlewares.raw;
module.exports.static = middlewares.static;
module.exports.text = middlewares.text;
module.exports.urlencoded = middlewares.urlencoded;
