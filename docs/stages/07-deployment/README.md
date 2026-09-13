# 7단계 — 이관·배포·복구

운영용 웹·문서 작업자·PostgreSQL 구성을 `Dockerfile`, `compose.production.yaml`로 분리했다. 개발 환경의 DB·원본·계정과 서로 다른 Compose 프로젝트 및 볼륨을 사용한다. 실제 외부 서버 배포는 수행하지 않았다.

## 기존 자료 조사

읽기 전용으로 `/Users/jikime/Dev/Private/Experimental/llm_wiki`의 `raw/sources`, `wiki`를 확인했다. 둘 다 없으며 기존 저장 데이터 0개다. 이 저장소는 프로그램 코드이고 별도의 데스크톱 사용자 데이터 경로는 제공되지 않았다. 현재 P7-01은 이관 데이터 없음으로 해당 없음이다. [조사 결과](./LEGACY_INVENTORY.json)를 남겼다.

```sh
node scripts/inventory-legacy.mjs /지정한/기존프로젝트
```

도구는 문서 수·상대 경로·SHA-256·경로 기반 식별자를 출력하고 원본을 변경하지 않는다. 같은 경로의 개정은 식별자를 유지하며 내용 해시만 달라진다. 심볼릭 링크와 25MB 초과 파일은 사유와 함께 제외한다. 데이터가 제공되면 제목·frontmatter·링크·근거·승인 이력을 조사한 뒤 이관 변환 규칙을 확정한다. 현재 데이터 변환기나 실제 이관이 완료됐다는 의미는 아니다. 승인 기록이 검증되지 않은 위키의 기본 제안 상태는 검토 대기다.

## 운영 구성

- 웹과 작업자는 동일한 고정 이미지를 사용한다. Node 22.23.1과 pgvector/PostgreSQL 17의 digest를 고정했다. `tsx`는 문서 작업자·파서·마이그레이션 실행에 필요해 운영 의존성에 포함했다.
- 컨테이너에서 `node` 사용자로 실행한다. DB 앱 접속 계정은 슈퍼유저·DB 생성·역할 생성 권한이 없다. DB 포트는 외부에 공개하지 않는다.
- 원본은 `/var/lib/wiki/originals` 전용 볼륨에 저장한다. 앱 공개 디렉터리와 분리한다. 웹은 호스트 `127.0.0.1`에만 연결하고 운영 HTTPS 역방향 프록시 뒤에 둔다.
- 빌드에는 `.env*`, `.local`, 개발 원본, 계정 파일을 포함하지 않는다. 실행 비밀값은 호스트 `.local/deploy/<프로필>/runtime.env`에 저장하고 파일 권한은 0600으로 제한한다. 이 파일 및 초기 관리자 파일은 Git에서 제외한다.
- DB 준비, 스키마 적용, 초기 관리자 생성, 웹·작업자 실행 순서다. 초기 관리자 생성은 기존 작업공간이 있으면 거부하며, 개발용 고정 메일 계정을 운영에 자동 생성하지 않는다.
- 로그는 컨테이너마다 10MB × 3개로 제한한다. 모델 비밀값·DB 암호·초기 암호를 명령 출력에 표시하지 않는다.

## 실행 순서

호스트에 Docker Compose와 Node 22, 잠금 파일에 따른 `npm ci`가 필요하다. 빌드·운영 전에 Docker 파일시스템 여유를 확인한다. 이 프로젝트의 빌드·복구 시험에는 최소 5GB 이상의 여유 공간을 권장한다.

```sh
# Docker가 사용하는 파일시스템 확인
# node 이미지는 Dockerfile에 고정한 것과 동일한 버전을 사용한다.
docker run --rm node:22.23.1-bookworm-slim df -h /
docker build -t my-domain-wiki:release-001 .

node scripts/deploy.mjs setup wiki-production 3011 https://wiki.example.com admin@example.com my-domain-wiki:release-001 '우리 업무 위키'
node scripts/deploy.mjs init wiki-production
node scripts/deploy.mjs bootstrap wiki-production
node scripts/deploy.mjs up wiki-production
node scripts/deploy.mjs status wiki-production
```

위 메일·서비스 주소·이미지 태그는 실제 환경 값으로 바꾼다. 초기 암호는 `.local/deploy/wiki-production/initial-admin.json`에서 확인한다. 회사 모델 설정은 `runtime.env`의 서버 설정을 채운 뒤 `up`으로 적용한다. 실제 업무 역할은 관리자 화면에서 작성·검토·이용 직원으로 나누어 생성한다.

HTTPS 프록시는 스트림 응답의 버퍼링을 끄고 파일 업로드 크기와 모델 응답 시간을 허용해야 한다. [Nginx 예시](../../../deploy/nginx.example.conf)를 실제 TLS 인증서·도메인에 맞추어 적용한다. 외부 주소·인증서·접근 권한이 제공되기 전에는 로컬 리허설까지만 수행한다.

## 백업·복구

```sh
node scripts/backup.mjs wiki-production .local/deploy/backup-20260909

# 기존 프로필과 다른 새 프로필로만 복원한다. init·bootstrap은 하지 않는다.
node scripts/deploy.mjs setup wiki-restored 3012 https://restored.example.com admin@example.com my-domain-wiki:release-001 '복구 공간'
node scripts/restore.mjs wiki-restored .local/deploy/backup-20260909
node scripts/deploy.mjs up wiki-restored
```

백업은 웹·작업자를 멈추고 DB custom dump와 원본을 함께 저장한 뒤 원래 실행 중이던 서비스를 재개한다. 공개 스키마의 모든 테이블 행 수·행 내용 지문, 적용 마이그레이션, 실행 이미지 ID, DB dump SHA-256, 원본 키·크기·SHA-256을 기록한다. DB가 백업 도중 변경되면 성공으로 처리하지 않는다. 메모리 사용을 줄이기 위해 큰 DB 파일의 해시는 스트림으로 계산한다.

복원은 다른 새 프로필의 빈 DB에만 적용하며 기존 DB·서비스를 덮어쓰지 않는다. 백업 당시 이미지 이름과 실제 이미지 ID를 대조한다. DB 및 원본의 해시를 먼저 확인하고, 복원 후 모든 공개 테이블 행 수·내용 지문·마이그레이션과 실제 볼륨의 원본 파일을 다시 확인한다. 실패한 새 환경은 실행하지 않고 원본 환경을 유지한다.

백업에는 비밀번호 해시·개인 대화·원본 자료가 포함된다. 암호화된 저장소에 복사하고 접근과 보존 기간을 정한다. 실행 비밀키·모델 접속 정보는 별도 비밀 저장소에 보관한다. 새 인증 비밀키로 복원하면 브라우저에서 다시 로그인한다. 원래 계정과 업무 내용은 복원 DB를 사용한다. 새로운 초기 관리자 파일은 복원 과정에서 사용하지 않는다.

## 배포 실패 대응

1. 배포 전 백업과 이전 고정 이미지를 보관한다. 작업자를 포함해 변경할 범위와 DB 변경 호환성을 확인한다.
2. 서비스 중지 → 새 이미지 설정 → `init`으로 마이그레이션 → `up` → health·로그인·원본·게시 위키·대화 확인 순서로 진행한다. `init`은 기존 데이터나 관리자 암호를 초기화하지 않는다.
3. DB 스키마가 이전 앱과 호환되면 `image` 명령으로 이전 이미지로 되돌리고 `up`을 실행한다. `image`는 기존 실행 설정 사본을 0600 파일로 남긴다.
4. 파괴적인 스키마 변경이 있거나 호환성을 확인하지 못했다면 이전 코드를 현재 DB에 연결하지 않는다. 배포 전 백업을 **새 프로필**로 복원·검증한 뒤 프록시 연결을 전환한다. 실패 환경은 조사할 수 있도록 유지한다.

```sh
node scripts/deploy.mjs stop wiki-production
node scripts/deploy.mjs image wiki-production my-domain-wiki:release-002
node scripts/deploy.mjs init wiki-production
node scripts/deploy.mjs up wiki-production
# 스키마 호환성이 확인된 경우 이전 버전으로 복귀
node scripts/deploy.mjs image wiki-production my-domain-wiki:release-001
node scripts/deploy.mjs up wiki-production
```

테스트 명령과 결과는 [검증 기록](./VERIFICATION.md), 실제 팀 시험의 남은 입력은 [팀 시험표](./TEAM_ACCEPTANCE.md)에 기록한다.

## 설계 근거

Next.js 설치 문서의 self-hosting·output 지침을 확인했고 표준 Node 서버 실행 방식을 사용했다. 웹 외에 독립 문서 작업자와 하위 파서가 있어 운영 의존성과 실행 파일을 이미지에 함께 포함한다. [PostgreSQL SQL dump 문서](https://www.postgresql.org/docs/17/backup-dump.html)의 DB 스냅샷 보장에 더해 앱·작업자를 멈춰 원본 파일과 시점을 맞춘다. 복원에는 [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)의 단일 트랜잭션·오류 시 중단 옵션을 적용했다. 서비스 시작 순서는 [Docker Compose 공식 문서](https://docs.docker.com/compose/how-tos/startup-order/)의 health 조건을 따른다.
