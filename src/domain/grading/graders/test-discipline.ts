import { registerGrader } from '../registry';
import { source } from './test-discipline/source.generated';

export const TEST_DISCIPLINE = 'fieldnote/test-discipline';

// The third built-in and the first code grader. It ships a program because
// the primitives cannot express "a source file has a test with the same stem",
// and the extraction rule says the answer to that is kind: code, not a new
// primitive. It is an ordinary grader: in production its program runs in the
// sandbox exactly as a stranger's would, even though fieldnote wrote it.
export const testDisciplineManifest = registerGrader({
  id: TEST_DISCIPLINE,
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'test-discipline',
  kind: 'code',
  needs: { 'repo.tree': ['**/*'] },
  code: { source },
  insufficientReason: 'Fewer than five source files — not enough code to judge how it is tested.',
  disclaimer:
    'This reads file names, not test contents: a test file with a matching name is not proof the code is tested.',
  card: {
    title: 'Test Discipline',
    tagline: 'Does the code here come with tests, and are they where the code is?',
    groups: [
      { title: 'Presence', checks: ['tests-exist'] },
      { title: 'Coverage by name', checks: ['tests-beside-source', 'tests-in-every-folder'] },
    ],
  },
  checks: [
    {
      id: 'tests-exist',
      title: 'Tests exist',
      points: 20,
      explain: {
        pass: 'Found test files in the repository.',
        fail: 'No test files were found.',
      },
    },
    {
      id: 'tests-beside-source',
      title: 'Source files have tests',
      points: 40,
      explain: {
        pass: 'At least half the source files have a test file with a matching name.',
        fail: 'Fewer than half the source files have a test file with a matching name.',
      },
    },
    {
      id: 'tests-in-every-folder',
      title: 'Every code folder has tests',
      points: 40,
      explain: {
        pass: 'Every code folder has tests.',
        fail: 'Some code folders have no tests.',
      },
    },
  ],
});
