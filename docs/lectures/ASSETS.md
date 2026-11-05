# 강의 도입 이미지 제작 기록

## 사용한 이미지

- 생성 방식: 내장 `image_gen` 도구. 별도 API·CLI를 사용하지 않았습니다.
- 프로젝트 저장 위치: [knowledge-library.png](../../public/lectures/assets/knowledge-library.png)
- 용도: 강의 목록과 일러스트형 표지. 2회차 첫 장은 실제 화면 비교형을 사용합니다.
- 의미: 흩어진 문서가 열린 책과 연결된 지식 서가로 모이는 모습
- 적용: 각 HTML에 이미지를 포함해 파일 하나만 열어도 표시합니다.
- 화면 안내: 실제 제품 화면은 생성 이미지로 만들지 않았습니다. 현재 자료에서는 로그인 후 캡처한 실제 화면을 사용합니다. 개발 목표는 별도 설명이나 ‘변경 목표 예시’로 구분합니다.

## 최종 생성 프롬프트

```text
Use case: illustration-story. Asset type: hero artwork for a premium Korean classroom presentation about building a company knowledge wiki. Create a wide 3:2 editorial still-life illustration, beautifully crafted tactile paper sculpture and matte ceramic miniature architecture: loose cream paper documents on the left become an orderly open book and a small architectural library of connected knowledge shelves on the right, a subtle path with small rose-colored connection markers joins them. One open book is the central focal point, with elegantly arranged page layers and knowledge cards. Quiet sophisticated studio art direction, off-white/ivory background, dusty mauve rose #CE8A99, deep muted rose #A16E72, charcoal accents. Warm directional light and natural soft sculptural shadows, high detail paper texture, generous clean negative space, composed as a complete standalone artwork that can sit in the right half of a slide. No writing, no labels, no letters, no numbers, no logos, no interface screens, no watermarks, no neon colors, no cartoon robots. This is a conceptual illustration, not a diagram or screenshot.
```

생성된 이미지를 확인한 뒤 원본을 프로젝트에 복사했습니다. 이미지 자체를 회사의 실제 자료나 서비스 화면으로 소개하지 않습니다.


## 실제 화면 캡처

- 위치: `public/lectures/assets/screens/`의 PNG 8개. 브라우저 캡처 범위를 지정해 핵심 영역을 담았으며 원본 PNG의 화면 내용을 합성하지 않았습니다.
- 확인 환경: 로컬 스타터킷, 가상 교통관제 자료 도메인, 프로젝트 A/B, 교육 계정. 캡처 기간은 2026-10-25–26입니다.
- 화면: 홈 바로가기, 게시 위키, 채팅, 검색 결과, 기록 범위 선택, 기록 네 입력칸, RFP 항목 입력.
- 홈·검색·기록·RFP는 작성 직원 계정으로 확인했습니다. 위키·채팅도 로그인한 교육 계정에서 보이는 실제 화면입니다. 자료는 모두 가상입니다.
- 게시 위키는 샘플 준비 과정에서 작성·검토한 내용입니다. AI 생성 성공이나 회사 배포를 입증하지 않습니다. RFP는 A 사업 개요를 연습 원문으로 선택한 개선 전 입력 화면이며 저장된 분석 결과가 아닙니다.
- ‘검색 55개’ 등 수량은 캡처 당시 상태입니다. 문서·문단·게시 위키의 단위를 구분하며 고정된 정답으로 사용하지 않습니다.
- 원본 화면 검토 기록: `_workspace/starterkit-screen-review-2026-10-25/`. 각 HTML에 PNG를 내장하고 확대 보기에서도 같은 이미지를 사용합니다.

## 2회차 검색 조건 저장·자료 즐겨찾기 안내

- 1장에는 실제 `home-source-card.png`와 개발할 업무 기능 도식을 비교합니다. 목표는 설명용 HTML 도식이며 아직 구현 전임을 표시합니다.
- 3·4장은 기존 `home.png`, 7장은 기존 `search.png`를 그대로 사용합니다. PNG 원본을 편집하지 않았습니다.
- 10장은 앞 실습에서 교육생이 만들 완료 목표를 나타냅니다. 현재 스타터킷의 완성 화면이나 코드에서 확인한 기존 기능으로 소개하지 않습니다.
- 13장은 현재 자료·위키 상세의 목록 링크를 코드로 확인한 도식이며, 홈에서 검색 결과나 즐겨찾기를 열고 자료를 읽은 뒤 같은 목록으로 돌아오는 기능은 앞으로 개발할 목표입니다.
- 과거 로그인 캡처와 현재 코드를 근거로 합니다. 캡처 속 가상 자료와 수치는 현재 DB 상태의 증거가 아닙니다.
- 이번 공개 강의·워크북 검증 기록은 `_workspace/week02-project-curriculum/`에 보관합니다. 개인 기능 자체의 구현과 실제 교육생 개발 시간 측정은 별도입니다.

## 2회차 첫 장의 구체적인 동작 예시

2026-10-28: 첫 장 왼쪽의 `home-source-card.png`는 그대로 유지했다. 오른쪽은 A 검색 조건 저장, B 별표로 자료 즐겨찾기를 보여 주는 두 칸의 HTML 설명으로 바꿨다. 새로 구현한 앱 화면이나 AI 생성 이미지가 아니다. 워크북에서 설명용 문서 이름과 실제 샘플 자료를 연결하며, ‘내 메모’는 사용자가 즐겨찾기에 적는 글로 구분한다.

## 3회차 기록 개발 화면 · 2026-11-03

로컬 앱에 관리자·검토 직원 계정으로 로그인해 가상 교육 자료를 확인했다. 다음 네 PNG는 실제 화면의 해당 영역을 브라우저에서 캡처했다. 화면 내용을 합성하거나 아직 없는 버튼을 그려 넣지 않았다.

- `record-writing.png`: 상황·판단과 이유·결과·추가 확인할 내용의 현재 빈 입력칸. 네 입력칸을 설명하는 참고 캡처. 표지와 1교시 도입은 아래 record-menu.png로 교체했다.
- `record-entry.png`: 기록 제목·도메인·프로젝트와 기존 도메인 기록 안내. 준비 화면.
- `source-record-start.png`: 공개된 프로젝트 A 검수 조건의 원문 문단. 기록 시작 버튼은 앞으로 개발할 기능.
- `record-list.png`: 공개된 날짜 필터 경험 기록이 보이는 현재 실무 기록 목록. 검색 입력칸과 즐겨찾기 연결은 개발 목표.

기존 캡처 파일은 유지했다. 자료는 가상이며 기록 저장·AI 실행·공개 승인을 하지 않았다. 도메인 선택은 기록 폼의 화면 확인 용도였다. 이 캡처는 교육생이 만들 개선 기능의 완성 증거가 아니다.

### 실무 기록 메뉴와 작성 위치 보완

`record-menu.png`는 2026-11-03 실행 중인 로컬 앱에 로그인해 상단 실무 기록 메뉴·작성 버튼·팀의 경험 목록·새 실무 기록 영역을 함께 캡처했다. 1440px 화면에서 상단 브랜드를 제외한 1440×780 범위를 사용했으며 화면을 합성하지 않았다. 첫 장과 1교시 도입에 사용하고 원본 확대 보기를 제공한다. 현재 작성 버튼은 아래 폼으로 이동한다. 모달은 교육생이 개발할 목표이며 캡처에 구현된 것처럼 표시하지 않는다.

### 전체 장의 진입 경로 재점검 · 2026-11-03

실제 브라우저에서 실무 기록 목록·작성 폼·관리의 도메인 수정·자료실·검수 조건 원문·공개 경험 기록 상세를 열어 대조했다. 다음 두 캡처는 로그인한 관리자 계정에서 확인한 가상 자료이며 1440×900 화면 중 상단 브랜드를 제외한 1440×780 범위다.

- `source-record-context.png`: 자료실 메뉴, 프로젝트 A 상태 화면 검수 조건의 제목, 추출한 원문과 공개 상태. 16장의 기존 본문 일부 캡처를 대체한다. 기록 시작 버튼은 아직 없다.
- `record-detail-context.png`: 실무 기록 목록에서 연 공개 경험의 제목·작성자 진술·자료실 복귀 링크. 21장에 사용한다. 내 확인할 일 입력과 기록 목록으로 돌아가기 개선은 개발 목표다.

11장은 1교시에서 만들 모달과 유형 안내를 설명하는 HTML 도식으로 바꿨다. 아직 구현되지 않은 목표를 실제 앱 캡처처럼 표시하지 않는다. 기존 PNG는 참고용으로 유지했으며 이미지 내용을 합성하지 않았다.


### 3교시 도입과 이전 교시 연결

29장은 각 교육생이 2교시에서 만든 내 초안 화면을 직접 열어 시작한다. 공통 스타터킷 캡처로 개인별 개발 결과를 대신하지 않고, 이전에 만든 기능과 이번에 더할 기능을 나란히 보여 준다. 기존 source-record-context.png는 자료실의 공개 원문 위치를 확인하는 참고 캡처로 보관한다.
