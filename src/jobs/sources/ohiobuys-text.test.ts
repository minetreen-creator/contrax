import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewOhioText} from './ohiobuys-text';

const row = (id:string,type='Quick Quote',status='Open for Bidding',due='10/15/2026 1:00:00 PM') =>
  `Edit Test\t${id}\tTest\t9/29/2026 1:00:00 PM\t9/29/2026 1:00:00 PM\t${due}\t10/1/2026 1:00:00 PM\tCleaning services\t\nMBE Set Aside\nAgency\t${status}\t\nAwarded\n${type}\n`;
test('reject cancellation, expired, evaluation and duplicated identities',()=>{
  const r=reviewOhioText(row('SRC001')+row('SRC001')+row('SRC002','Cancellation')+row('SRC003','Quick Quote','Under Evaluation')+row('SRC004','Quick Quote','Open for Bidding','9/28/2026 1:00:00 PM'),new Date('2026-09-29T20:36:00Z'));
  assert.equal(r.rows.length,1);
  assert.deepEqual(r.skipped,{duplicate:1,non_bid_or_qualification:1,not_open:1,expired:1});
  assert.equal(r.rows[0].due_date,'2026-10-15T17:00:00.000Z');
  assert.equal(r.rows[0].agency,'Agency');
  assert.equal(r.rows[0].set_aside,undefined);
});
