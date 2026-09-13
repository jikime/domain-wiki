# 7단계 검증 기록

검증일: 2026-09-09. 실제 외부 서버 배포·회사 모델·고객 자료는 사용하지 않았다. Docker의 독립 프로젝트에서 실행 이미지, DB, 원본 저장소를 분리해 재현했다.

| 검사 | 결과 |
| --- | --- |
| 기존 저장소 읽기 전용 조사 | `raw/sources`, `wiki` 데이터 0개. 이관 대상 없음 |
| 조사 도구 | 반복 결과 동일, 원본 보존, 개정 시 경로 ID 유지·해시 변경, 심볼릭 링크 제외 통과 |
| Linux 운영 이미지 | Node 22.23.1에서 빌드·타입 검사, 일반 사용자 웹·작업자 실행 통과 |
| 초기화·계정 | 일반 DB 접속 계정, 마이그레이션 재실행, 기존 공간 보존, 초기 관리자 중복 생성 거부 통과 |
| 문서 처리 | 운영 작업자에서 Markdown·DOCX·텍스트 PDF 실제 업로드→추출→검토→공개 통과 |
| 위키·근거 | 작성 직원 생성→검토 직원 승인, 실제 30초 조건 문단을 연결한 개정본 게시 통과 |
| 백업 | 웹·작업자 중지 후 DB 31개 테이블·원본 3개, DB 변경 여부·원본 해시 검증 통과 |
| 변조 차단 | dump 변조·원본 변조 각각 복구 DB 생성 전에 거부 |
| 새 환경 복구 | 적용 마이그레이션, 전체 공개 테이블의 행 수·내용 지문, 실제 볼륨 원본 크기·해시 일치 |
| 복구 후 기능 | 기존 계정 로그인, 직원의 관리 API 403, 원본 3개 다운로드, 위키 본문, 저장 답변·인용 1개 확인 |
| 실제 브라우저 | 복구 전후 위키·대화·원본 390px 화면, 넘침 없음·JavaScript 오류 0개 |
| 전체 회귀 시험 | 시간대 수정 후 **58개 통과, 1.3분**. 서버 UTC·브라우저 Asia/Seoul 조건 포함 |
| 정적 검사 | Biome 155개 파일, `git diff --check` 통과 |
| 배포 실패 복귀 | 잘못된 앱 이미지의 health 실패→이전 이미지 복귀, DB 행 수 보존 및 화면·원본·대화 재검증 통과 |

저장 대화는 복구 충실도를 시험하기 위해 고정 질문·답변·실제 원문 문단을 DB에 넣은 합성 표본이다. 모델 호출을 하지 않았으며 모델 답변 품질을 검증한 결과가 아니다. 실제 팀 시험은 [인수 시험표](./TEAM_ACCEPTANCE.md)의 입력 대기 항목으로 남아 있다.

## 재현 명령

```sh
node scripts/check-deployment-tools.mjs
node scripts/rehearse-deployment.mjs seed wiki-stage7
node scripts/rehearse-deployment.mjs verify wiki-stage7
node scripts/backup.mjs wiki-stage7 .local/deploy/backup-stage7-final
node scripts/check-restore-guards.mjs wiki-stage7-final .local/deploy/backup-stage7-final
node scripts/restore.mjs wiki-stage7-final .local/deploy/backup-stage7-final
node scripts/deploy.mjs up wiki-stage7-final
node scripts/rehearse-deployment.mjs verify wiki-stage7-final wiki-stage7
node scripts/rehearse-rollback.mjs wiki-stage7-final
npm run test:integration
```

`seed`와 `restore`는 새 시험 환경을 준비한 뒤 한 번 실행한다. 이미 완료한 프로필·백업 폴더는 덮어쓰지 않는다. 실제 리허설의 원본 환경은 `wiki-stage7`(3011), 최종 복구 환경은 `wiki-stage7-final`(3013)이다. 설정·계정·백업 파일은 Git에서 제외된 `.local/deploy`에 보관한다.

## 발견하고 수정한 사항

1. Linux 서버의 UTC와 브라우저의 한국 날짜가 달라 대화 목록에서 React hydration 오류가 발생했다. 날짜·시간 표시를 `Asia/Seoul`로 명시하고 실제 컨테이너 화면에서 오류가 사라졌음을 확인했다.
2. 일반 계정으로 복원할 때 관리자 소유 pgvector 확장의 `COMMENT`를 변경하려다 중단됐다. 확장은 관리자가 먼저 준비하고 앱 데이터는 일반 계정으로 복원하며 `--no-comments`를 사용한다. DB 객체 설명 주석은 복원에서 제외되고 업무 데이터·함수·근거·버전은 복원된다.
3. 현재 Docker Compose의 `create`에는 `--no-deps`가 없다. 지원되는 생성 명령으로 수정하고 신규 환경 복원 전 과정을 다시 실행했다. 복원 실패 단계가 출력에 표시되도록 개선했다.
4. Docker 디스크 부족으로 DB 시작이 멈췄다. 다시 만들 수 있는 빌드 캐시를 정리해 여유 공간을 확보하고 기존 개발 DB·웹의 정상 응답을 확인했다. 원본·DB 볼륨과 기존 다른 프로젝트 이미지는 삭제하지 않았다. 운영 절차에 파일시스템 여유 확인을 추가했다.

## 화면 증거

- [복구된 위키·조건 문단](./screenshots/wiki-stage7-final-wiki.png)
- [복구된 대화·인용](./screenshots/wiki-stage7-final-chat.png)
- [복구된 DOCX 원본](./screenshots/wiki-stage7-final-source.png)

## 실제 출시 판단

외부 HTTPS 프록시·인증서 적용, 실제 백업 저장소의 암호화·보존·복구 목표, 회사 모델 및 대표 고객 문서·팀 사용자 시험은 아직 수행하지 않았다. 7단계 로컬 배포·복구 기능은 검증했고 P7-03 실제 팀 인수 판단은 대기다. 이후 8단계 구현과 최종 전체 70개 시험, 38개 테이블·원본 4개를 포함한 추가 복원 검증까지 완료했다. [최신 결과](../08-business/VERIFICATION.md)를 참고한다.
