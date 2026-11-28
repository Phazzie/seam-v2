// What each phase of a project means, in a phrase the owner can read (the report and the approval page use it).
import type { Phase } from '../types.ts';

export const PHASE_WORDS: Record<Phase, string> = {
  setup: 'getting set up and working out what to build',
  survey: 'looking over the existing app',
  plan1: 'planning, round 1: the features and how they split into parts',
  probe: 'trying out the outside services the app depends on',
  plan2: 'planning, round 2: the contracts and the file-by-file plan',
  skeleton: 'writing the empty skeleton of every planned file',
  tests: 'writing the tests every file has to pass',
  build: 'the builders are filling in the files',
  flip: 'switching the pretend services over to the real ones',
  cutover: 'cutting over from the old app to the new one',
};
