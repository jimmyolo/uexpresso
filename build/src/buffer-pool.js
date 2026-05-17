'use strict';

// Size-bucketed Buffer pool for body-parser pre-allocation.
//
// acquire(minSize) returns the smallest bucket-sized Buffer that fits, reusing
// a previously released buffer when available. Sizes above the largest bucket
// fall back to a fresh Buffer.allocUnsafe and are not pooled. release(buf) only
// re-files buffers whose .length matches a bucket size, and each bucket free
// list is capped to bound peak memory.

const BUCKETS = [4096, 16384, 65536, 524288, 1048576, 10485760];
const MAX_PER_BUCKET = 8;

const free = new Map();
for(const size of BUCKETS) free.set(size, []);

function findBucket(minSize) {
    for(let i = 0; i < BUCKETS.length; i++) {
        if(BUCKETS[i] >= minSize) return BUCKETS[i];
    }
    return -1;
}

function acquire(minSize) {
    const bucket = findBucket(minSize);
    if(bucket === -1) {
        return { buffer: Buffer.allocUnsafe(minSize), pooled: false };
    }
    const list = free.get(bucket);
    const buf = list.length > 0 ? list.pop() : Buffer.allocUnsafe(bucket);
    return { buffer: buf, pooled: true };
}

function release(buf) {
    if(!buf) return;
    const list = free.get(buf.length);
    if(list && list.length < MAX_PER_BUCKET) {
        list.push(buf);
    }
}

function _drain() {
    for(const list of free.values()) list.length = 0;
}

module.exports = { acquire, release, _drain, BUCKETS, MAX_PER_BUCKET };
