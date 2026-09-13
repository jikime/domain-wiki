# 8단계 검증 기록

검증일: 2026-09-09. 가상 기관 HTML·개발용 RFP·고정 응답 시험 모델을 사용했다. 실제 기관 자료나 회사 모델의 분석 품질을 판정한 결과가 아니다.

## 기능과 화면

| 검사 | 결과 |
| --- | --- |
| 기관 설정 | 관리자만 등록·중지 가능, 작업공간·HTTPS·경로 경계·확인 입력 검사 통과 |
| 원문 수집 | 실제 앱의 수집 코드에서 HTML 원본·SHA-256·문단·표·날짜 후보·첨부·중복 요청 보존 통과 |
| 수집 제한 | 내부 IP·범위 밖 이동·과대 응답·비정상 HTTP·수집 도중 사이트 중지 차단, 같은 범위 이동·PDF 첨부 처리 통과 |
| 공식 확인 | 원본 공개 선행, 다른 직원 대조, 날짜 형식·확인 입력·이력 검사 통과 |
| RFP 직접 작성 | 5종 분류, 실제 인용 구절·근거 ID·범위, 추론·불명확 항목 질문 검증 통과 |
| RFP 검토 | 초안·제출·담당·반려·승인·공유·내려받기, 자기 승인 거부, 이전 게시본 보존·버전 충돌 검사 통과 |
| AI 초안 계약 | 구조·허위 ID·원문에 없는 구절·중복 실행·사용량 기록, 원문 철회 시 진행 중 결과 저장 차단 통과 |
| 근거 개정·철회 | 이용 직원의 목록·상세·내려받기 차단, 작성자 재검토 표시, 원본 영향·삭제 제한 통과 |
| 작업자 복구 | 2분 이상 끊긴 수집의 실패 상태 정리 통과 |
| 브라우저 | 시험 서버에서 직접 작성·인용·검토 게시·공식 날짜 확인, 390px 새 화면 7개 넘침 없음·JS 오류 0 |
| 실제 개발 서버 | 3010에서 RFP 선택→두 항목 작성→인용→제출→다른 직원 승인→일반 직원 열람·내려받기 통과 |
| 미설정 상태 | 회사 모델 미설정 안내·AI 버튼 비활성, 허용 기관·수집 후보 빈 화면 확인 |
| DB 재현 | 빈 PostgreSQL DB에 전체 마이그레이션 2회, 이력 8개·업무 테이블 38개 일치 |

수집 시험은 DNS와 HTTPS 응답만 테스트 프로세스에서 가상 기관으로 바꾼다. 앱의 URL·DNS 주소·이동·응답 크기 검사와 실제 저장·추출·검토는 실행한다. 외부 기관의 실제 TLS 연결을 검증한 것으로 해석하지 않는다. 이 시험용 preload 파일은 Docker 이미지에서 제외한다.

## 발견해 수정한 오류

1. RFP 상세 조회에서 하위 SQL이 상위 보고서 버전 ID 대신 내부 문단 ID를 비교해 철회된 근거를 유효하다고 표시했다. 상위 테이블 이름을 명시해 수정했다. 실제 DB의 철회 상태와 목록·상세·내려받기·진행 중 생성의 거부를 함께 검증했다.
2. 기존 화면 시험의 메뉴 수를 새 업무 도구가 추가된 관리자 8개·이용 직원 6개로, 마이그레이션 이력을 8개로 갱신했다. 관리·검토 권한 제한 검사는 유지했다.
3. 독립 수집 검사에서 아무 I/O가 없는 가상 DNS 대기는 자동 해제되는 시간 제한 때문에 조기 종료했다. 명시적인 취소 타이머로 바꾸고 끝까지 검사 결과가 출력되는 것을 확인했다.

## 재현 명령

```sh
npm run lint
npm run test:official
npm run test:integration
```

8단계 전용 통합시험은 **12개 통과, 24.3초**, 최종 전체 회귀는 **70개 통과, 1.8분**이다. Linux 최종 운영 이미지의 빌드·TypeScript 검사도 통과했다. Biome 174개 파일과 문서 링크 검사를 통과했고, 공식 UI 바깥의 기본 입력·선택·체크박스 요소는 없다.

## 화면 증거

- [개발 서버 RFP 직접 작성](./screenshots/dev-rfp-editor-mobile.png)
- [개발 서버 직원 검토 후 보고서](./screenshots/dev-rfp-report-mobile.png)
- [기관 미등록 상태의 수집 화면](./screenshots/dev-official-empty-mobile.png)
- [관리자의 기관 설정 화면](./screenshots/dev-sites-empty-mobile.png)

## 실제 업무 검증 대기

P8-01·P8-02의 화면·API·저장·검토 기능과 개발 표본 검사는 구현했다. 사용자가 허용할 실제 기관 주소, 대표 RFP·적용 기준·사례, 회사 모델·임베딩 및 실제 검토 직원이 없어 실제 수집 적합성과 RFP 해석 품질의 최종 체크는 남긴다. 검색 후보나 고정 모델 응답을 실제 공식 자료 확인·업무 품질 통과로 표시하지 않았다.

## 최종 운영 이미지·백업·복원

- 이미지 `my-domain-wiki:stage8-20260909`를 Linux에서 빌드했다. 기존 7단계 복구 환경 `wiki-stage7-final`에 마이그레이션을 적용하고 기존 자료·위키·저장 대화를 유지했다.
- 운영 작업자에서 새 HTML RFP를 실제 업로드·추출했다. 문단·표 위치, 다른 직원의 원본 공개·RFP 검토 승인, 일반 직원의 근거·Markdown·HTML 원본 내려받기를 확인했다.
- `backup-stage8-final`에 **38개 테이블·원본 4개**를 백업했다. 새 프로필 `wiki-stage8-restored`에 복원해 전체 공개 테이블 행 수·내용 지문·마이그레이션·원본 크기·SHA-256 일치를 확인했다.
- 복원 뒤 실제 계정 로그인, 일반 직원의 관리 API 차단, 기존 원본 3종·위키·대화·인용, 새 HTML·RFP를 다시 조회했다. 모바일 4개 화면에서 가로 넘침 없음·JS 오류 0을 확인했다.
- 실행 이미지에서 테스트용 수집 후킹 파일, `.env.local`, `.local` 개발 계정·자료가 제외된 것을 확인했다.

```sh
node scripts/deploy.mjs image wiki-stage7-final my-domain-wiki:stage8-20260909
node scripts/deploy.mjs init wiki-stage7-final
node scripts/deploy.mjs up wiki-stage7-final
node scripts/backup.mjs wiki-stage7-final .local/deploy/backup-stage8-final
# 다른 새 프로필을 준비한 뒤 복원한다.
node scripts/restore.mjs wiki-stage8-restored .local/deploy/backup-stage8-final
node scripts/deploy.mjs up wiki-stage8-restored
```

완료한 프로필·백업은 덮어쓰지 않는다. 이 기록은 로컬 Docker 리허설이며 외부 서비스 배포가 아니다. 시험 컨테이너는 확인 후 중지하고 이미지·DB·원본·백업을 보관한다. 개발 서버 3010과 개발 문서 작업자는 계속 사용할 수 있다.

[복원된 RFP 보고서](./screenshots/wiki-stage8-restored-rfp-mobile.png) · [기존 위키](./screenshots/wiki-stage8-restored-wiki.png) · [저장 대화·인용](./screenshots/wiki-stage8-restored-chat.png) · [기존 원본](./screenshots/wiki-stage8-restored-source.png)
