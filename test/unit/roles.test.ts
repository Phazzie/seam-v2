import { describe, expect, test } from 'vitest';
import { roleOf } from '../../src/lib/roles.ts';
import type { HookInput } from '../../src/types.ts';

describe('roleOf', () => {
  const base: HookInput = { hook_event_name: 'PreToolUse', cwd: '/x' };
  test('no agent_type is the main agent', () => expect(roleOf(base)).toBe('main'));
  test.each(['builder', 'describer', 'checker', 'surveyor', 'design'] as const)('seam-v2:%s is %s', (name) => {
    expect(roleOf({ ...base, agent_id: 'a1', agent_type: `seam-v2:${name}` })).toBe(name);
  });
  test.each(['general-purpose', 'Explore', 'builder', 'seam-probe:builder', 'other:builder', 'seam-v2:', 'seam-v2:Builder', 'seam-v2:builder ', 'seam-v2:planner', ''])(
    'agent type "%s" is readonly', (agent_type) => expect(roleOf({ ...base, agent_id: 'a1', agent_type })).toBe('readonly'),
  );
  test('unknown agent type is readonly', () => expect(roleOf({ ...base, agent_type: 'general-purpose' })).toBe('readonly'));
  test('an agent_id with no agent_type cannot be told from a stranger, so it is readonly', () => {
    expect(roleOf({ ...base, agent_id: 'a1' })).toBe('readonly');
  });
  test('an agent_type that is not text is readonly', () => {
    expect(roleOf({ ...base, agent_type: 7 } as unknown as HookInput)).toBe('readonly');
  });
});
