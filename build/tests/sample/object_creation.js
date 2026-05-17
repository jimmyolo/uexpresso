const NullObject = function() {};
NullObject.prototype = Object.create(null);
const cnt = 100000;
const runs = 50;

function benchmark(callback) {
    const timings = [];
    for (let i = 0; i < runs; i++) {
        const start = process.hrtime.bigint();
        callback();
        const end = process.hrtime.bigint();
        timings.push(Number(end - start) / 1e6); // Convert to milliseconds
    }
    return timings;
}

function calculateStats(timings) {
    const sum = timings.reduce((acc, val) => acc + val, 0);
    const avg = sum / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    return { min, max, avg };
}

function printStats(label, timings) {
    const s = calculateStats(timings);
    console.log(`  ${label.padEnd(24)} Min: ${s.min.toFixed(2)} ms  Max: ${s.max.toFixed(2)} ms  Avg: ${s.avg.toFixed(2)} ms`);
}

const SEP = '='.repeat(62);

// ─── Scenario 1: Dictionary / cache（動態 key，大量查找）────────────────────

const dictKeys = Array.from({ length: 20 }, (_, i) => `key${i}`);

const dict_plain = benchmark(() => {
    for (let i = 0; i < cnt / 10; i++) {
        const obj = {};
        for (const k of dictKeys) obj[k] = i;
        for (const k of dictKeys) void obj[k];
        void obj['notExists'];
    }
});

const dict_null = benchmark(() => {
    for (let i = 0; i < cnt / 10; i++) {
        const obj = new NullObject();
        for (const k of dictKeys) obj[k] = i;
        for (const k of dictKeys) void obj[k];
        void obj['notExists'];
    }
});

// ─── Scenario 2: Options 物件（少數固定 key）────────────────────────────────

const opts_plain = benchmark(() => {
    let sum = 0;
    for (let i = 0; i < cnt; i++) {
        const obj = {};
        obj.host = 'localhost';
        obj.port = 3000;
        obj.debug = false;
        obj.timeout = 5000;
        obj.retry = 3;
        sum += obj.port + obj.timeout + obj.retry;
    }
    void sum;
});

const opts_null = benchmark(() => {
    let sum = 0;
    for (let i = 0; i < cnt; i++) {
        const obj = new NullObject();
        obj.host = 'localhost';
        obj.port = 3000;
        obj.debug = false;
        obj.timeout = 5000;
        obj.retry = 3;
        sum += obj.port + obj.timeout + obj.retry;
    }
    void sum;
});

// ─── Scenario 3: for...in 枚舉 ──────────────────────────────────────────────

const forin_plain = benchmark(() => {
    let count = 0;
    for (let i = 0; i < cnt / 10; i++) {
        const obj = {};
        for (const k of dictKeys) obj[k] = i;
        for (const k in obj) {
            void obj[k];
            count++;
        }
    }
    void count;
});

const forin_null = benchmark(() => {
    let count = 0;
    for (let i = 0; i < cnt / 10; i++) {
        const obj = new NullObject();
        for (const k of dictKeys) obj[k] = i;
        for (const k in obj) {
            void obj[k];
            count++;
        }
    }
    void count;
});

// ─── Scenario 4: 短暫使用、立即丟棄（建立速度）──────────────────────────────

const ephemeral_plain = benchmark(() => {
    let objs = [];
    for (let i = 0; i < cnt; i++) {
        objs.push({});
    }
    objs = null;
});

const ephemeral_null = benchmark(() => {
    let objs = [];
    for (let i = 0; i < cnt; i++) {
        objs.push(new NullObject());
    }
    objs = null;
});

// ─── Scenario 5: {...new NullObject()} vs {} ────────────────────────────────

const spread_plain = benchmark(() => {
    let objs = [];
    for (let i = 0; i < cnt; i++) {
        objs.push({});
    }
    objs = null;
});

const spread_null = benchmark(() => {
    let objs = [];
    for (let i = 0; i < cnt; i++) {
        objs.push({...new NullObject()});
    }
    objs = null;
});

// ─── 輸出結果 ────────────────────────────────────────────────────────────────

console.log(SEP);
console.log('Scenario 1: Dictionary / cache（動態 key，大量查找）');
printStats('{}', dict_plain);
printStats('new NullObject()', dict_null);

console.log(SEP);
console.log('Scenario 2: Options 物件（少數固定 key）');
printStats('{}', opts_plain);
printStats('new NullObject()', opts_null);

console.log(SEP);
console.log('Scenario 3: for...in 枚舉');
printStats('{}', forin_plain);
printStats('new NullObject()', forin_null);

console.log(SEP);
console.log('Scenario 4: 短暫使用、立即丟棄（建立速度）');
printStats('{}', ephemeral_plain);
printStats('new NullObject()', ephemeral_null);

console.log(SEP);
console.log('Scenario 5: {...new NullObject()} vs {}');
printStats('{}', spread_plain);
printStats('{...new NullObject()}', spread_null);

console.log(SEP);
