// 교육용 순수 함수 계약 검사. DB·네트워크·앱 설정을 사용하지 않습니다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('검사할 함수 파일을 지정하세요. 예: node docs/training/exercises/check-aliases.mjs src/lib/term-aliases.ts');
  process.exit(1);
}
const source = readFileSync(resolve(inputPath), 'utf8');
const { outputText } = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
});
const { splitAliases } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
assert.equal(typeof splitAliases, 'function', 'splitAliases 함수를 export해야 합니다.');

const many = Array.from({ length: 11 }, (_, index) => `용어${index + 1}`);
const cases = [
  ['기존 쉼표', 'VMS, 전광표지', ['VMS', '전광표지']],
  ['세미콜론', 'VMS; 전광표지', ['VMS', '전광표지']],
  ['전각 쉼표', 'VMS，전광표지', ['VMS', '전광표지']],
  ['구분자 혼합과 중복', 'VMS; 전광표지， VMS', ['VMS', '전광표지']],
  ['앞뒤 공백', '  VMS  , 전광표지  ', ['VMS', '전광표지']],
  ['빈 문자열', '', []],
  ['공백만 있는 입력', '   ', []],
  ['연속 구분자', 'VMS,,;，전광표지;', ['VMS', '전광표지']],
  ['입력 순서 유지', '전광표지;VMS;전광표지', ['전광표지', 'VMS']],
  ['내부 공백 유지', '상태 변경 이력; 상태 로그', ['상태 변경 이력', '상태 로그']],
  ['대소문자 임의 통합 안 함', 'VMS,vms', ['VMS', 'vms']],
  ['한 글자 값은 서버 검증에 맡김', 'A,VMS', ['A', 'VMS']],
  ['개수 초과를 조용히 자르지 않음', many.join(','), many],
  ['길이 초과를 조용히 자르지 않음', '가'.repeat(81), ['가'.repeat(81)]],
];

let failures = 0;
for (const [name, input, expected] of cases) {
  try {
    assert.deepEqual(splitAliases(input), expected);
    console.log(`통과: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`실패: ${name}`);
    console.error(error.message);
  }
}
console.log(`검사 대상: ${inputPath}`);
console.log(`총 ${cases.length}개 중 ${cases.length - failures}개 통과`);
console.log('이 결과는 순수 함수 계약만 확인합니다. 타입·서버 검증·화면 연결·검색은 별도로 확인하세요.');
process.exitCode = failures ? 1 : 0;
