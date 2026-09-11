import { describe, expect, it } from 'vitest';
import { ReplayFilter } from './replay';

describe('replay filter', () => {
  it('flags a repeated client id on the same channel', () => {
    const rf = new ReplayFilter();
    expect(rf.check('ch_1', 'uuid-a')).toBe(false);
    expect(rf.check('ch_1', 'uuid-a')).toBe(true);
  });
  it('same id on a different channel is not a duplicate', () => {
    const rf = new ReplayFilter();
    rf.check('ch_1', 'uuid-a');
    expect(rf.check('ch_2', 'uuid-a')).toBe(false);
  });
  it('unknown ids never flag; unbound messages bypass the filter entirely', () => {
    const rf = new ReplayFilter();
    expect(rf.check('ch_1', 'uuid-b')).toBe(false);
    expect(rf.check('ch_1', 'uuid-c')).toBe(false);
    expect(rf.check('ch_1', 'uuid-b')).toBe(true); // only the exact id duplicates
  });
  it('reset clears a channel so a history reload re-records from scratch', () => {
    const rf = new ReplayFilter();
    rf.check('ch_1', 'uuid-a');
    rf.reset('ch_1');
    expect(rf.check('ch_1', 'uuid-a')).toBe(false);
  });
});
