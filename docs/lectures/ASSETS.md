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
