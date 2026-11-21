import { test } from 'node:test';
import assert from 'node:assert';
import { Xiomb } from '../src/index.js';

test('Xiomb', () => {
    assert.ok(new Xiomb() instanceof Xiomb);
});
