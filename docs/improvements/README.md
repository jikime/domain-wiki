# 기능 개선 실행 기록

기준: [2026-09-09 기능 점검](../audits/2026-09-09/FEATURE_AUDIT.md). 각 단계는 구현 → E2E·검증 → 오류 수정 → 문서 기록 순서로 진행한다.

| 순서 | 범위 | 상태 |
| --- | --- | --- |
| 1 | [검색 통합·자료 유형 사전 필터·위키 대표 버전·목록 페이지·대화 서버 검색](01-search-lists/README.md) | 완료: E2E 81개, 개발 화면 30개 조합 |
| 2 | [작성 초안 보호·계정 비밀번호 변경 및 복구·AI 사용량](02-authoring-account-usage/README.md) | 완료: E2E 87개, 실제 OpenAI 토큰·운영 집계 확인 |
| 3 | [내 활동·프로젝트·후속 행동 연결·채팅 관리·관리 검색](03-activity-navigation/README.md) | 완료: 전체 E2E 92개, 추가 경계 포함 관련 18개, 개발 화면 42개 조합 |
| 4 | 핵심 기능 계획 9~16단계: 작업 큐부터 자동 분석·지식 관계·품질 검증 | [9단계](../stages/09-ai-foundation/README.md)·[10단계](../stages/10-document-analysis/README.md)·[11단계](../stages/11-wiki-generation/README.md)·[12단계](../stages/12-ingest-automation/README.md)·[13단계](../stages/13-graph-search/README.md)·[14단계](../stages/14-quality-review/README.md)·[15단계](../stages/15-knowledge-graph/README.md)·[16단계 완료](../stages/16-core-validation/README.md). 전체 198개·마지막 보완 관련 50개 통과, 실제 모델·48테이블 운영 복원 확인 |

완료 상태에는 실제로 실행한 검증만 기록한다. 실제 고객 문서를 필요로 하는 업무 품질 판정은 개발용 자료의 기능 검증과 구분한다.

추가 사용자 요청: [직원 복수 업무 권한·관리자 전체 권한](04-member-permissions/README.md) 완료(전체 115개 통합시험), [위키 본문 Milkdown 편집기](05-milkdown-editor/README.md) 완료(최종 전체 119개 통합시험). [Purpose·그래프 관련성 적용 검토](../audits/2026-09-09/PURPOSE_GRAPH_REVIEW.md)를 핵심 단계에 반영해 구현·검증을 완료했다.

[지식 그래프 원본 Sigma 화면 적용](06-sigma-graph/README.md): Sigma·React Sigma·ForceAtlas2를 원본과 같은 버전으로 적용하고, 그래프 중심 화면과 접힌 필터·인사이트로 교체했다.
