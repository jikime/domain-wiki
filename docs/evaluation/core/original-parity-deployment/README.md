# 원본 기능 복원 후 운영 이미지·백업 검증

2026-09-10 로컬 운영 환경을 새 기능으로 갱신하고 별도 환경에 복원했다. 실제 고객 데이터와 외부 HTTPS 서버의 운영 인수 검사는 포함하지 않는다. 기존 16단계 기록은 그대로 보존했다.

| 항목 | 확인 결과 |
| --- | --- |
| 최종 이미지 | `my-domain-wiki:original-parity-final-20260910` |
| 이미지 ID | `sha256:2c6fb75dd9a9c530adf01d4d1e9bcecf6694d8095742bf89c284db0230e8c13b` |
| 운영·복원 주소 | `localhost:3020` · `localhost:3022` |
| 스키마·계정 | 마이그레이션 30개, public 테이블 54개, 일반 DB 접속 계정 |
| 백업·복원 | 54개 테이블 전체 행 내용, 파일 16개 크기·SHA-256 일치 |
| 기존 자료 | 원문 해시, 위키 3개 본문·현재 근거, 저장 대화 6개, 품질 처리 이력 유지 |
| 새 자료 | 폴더 이미지·문서 사본·가져오기 경로, ZIP 숨김 파일·미지정 형식·빈 폴더, 취소한 조사 이력 유지 |
| 화면 | 각 환경의 1440px·390px 기존 화면 12곳과 390px 이미지 화면 1곳, 합계 26곳 정상 |
| 접근 제어 | 읽기 직원의 공개 문서 이미지 허용, 비공개 원본·작성자 조사 이력 차단 |
| 복원 거부 | DB 손상·원본 변조·동일 프로필·이미지 불일치·기존 서비스 덮어쓰기 거부 |
| 원본 보존 | 원본 저장소 파일 447개 SHA-256 일치 |

최종 Docker 빌드는 고정 Node.js 22.23.1·npm 10.9.8에서 `npm ci`, Next.js 빌드와 타입 검사, 운영 의존성 정리를 완료했다. 원본 AnyDoc·전자책·BMP/ICO 변환기를 Linux 바이너리로 포함한다. 로컬에서도 같은 잠금 파일로 새로 설치한 의존성을 사용해 빌드했다.

먼저 `original-parity-20260910` 이미지에서 새 자료를 등록·검토한 상태를 백업했다. 이 이미지로 빈 새 프로필에 복원하고 전체 행·파일 해시와 실제 화면을 대조했다. 이후 두 환경을 선택 문장 답변의 위키 링크 표시가 추가된 최종 이미지로 갱신하고 화면·권한·본문을 다시 확인했다. 이 마지막 갱신에는 DB 스키마 변경이 없다. 백업은 반드시 기록된 이미지로 먼저 복원한다.

기존 `localhost:3021` 복원 환경과 그 데이터는 이전 16단계 상태로 보존했다. 백업 원본, 환경 변수, 계정·세션 정보는 `.local` 아래에만 두고 문서·이미지·저장소 공개 대상에서 제외한다. 웹과 작업자가 같은 모델 설정을 받는지 확인했으며, 기록에는 키 값 대신 설정 여부만 남겼다.

새 이미지 자료는 직접 만든 64×40 PNG와 Markdown이다. 문서 소유 이미지 사본은 게시 문서를 통해 읽을 수 있고, 별도의 비공개 이미지 원본에는 접근할 수 없다. 아카이브에는 숨김 JSON, 4바이트 이진 파일, 빈 폴더를 넣어 내보내기 결과와 비교했다. 조사 기록은 실제 모델 호출 전에 취소한 가상 표본이다. 이 검사는 새 자료 형식과 이력의 복원을 입증하며 OCR·Vision·외부 검색 결과의 업무 정확성을 평가하지 않는다.

- [운영 실행 상태](wiki-stage16-main-snapshot.json) · [복원 실행 상태](wiki-stage16-parity-restored-snapshot.json)
- [운영 기존 자료·화면](wiki-stage16-main-verified.json) · [복원 기존 자료·화면](wiki-stage16-parity-restored-verified.json)
- [운영 새 자료·권한](wiki-stage16-main-new-records.json) · [복원 새 자료·권한](wiki-stage16-parity-restored-new-records.json)
- [백업·복원 요약](backup-summary.json) · [원본 보존](original-preservation.json)
- [최종 전체 검사 요약](validation-summary.json) · [문서 표본 보존 검사](parser-regression.json)
- [복원 이미지 390px](wiki-stage16-parity-restored-folder-image-390.png) · [복원 위키 390px](wiki-stage16-parity-restored-revision-wiki-390.png) · [복원 그래프 1440px](wiki-stage16-parity-restored-revision-graph-1440.png)

재검증은 `scripts/check-parity-deployment.mjs verify`, `scripts/rehearse-core-deployment.mjs verify`, `scripts/snapshot-parity-deployment.mjs`로 수행했다. 기존 자료 대조에는 `CORE_DEPLOYMENT_OUTPUT=docs/evaluation/core/original-parity-deployment`를 지정했다. 이 폴더의 `initial.json`·`revision.json`과 원문 두 개는 기존 16단계 고정 기준의 복사본이며, 새 실제 모델 정리·개정 결과는 [별도 평가](../ingest-12-original-parity-20260910/README.md)에 있다.
