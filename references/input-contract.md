# 실행 입력과 검수 기록

아래는 현재 지원 경로의 필드 안내다. 관찰 입력을 자동 생성하는 양식이나 PASS 템플릿이 아니다. 좌표는 명시된 원본 공간을 사용한다. 목적지 도트를 지정하여 그림을 덧칠하는 지시는 받지 않는다.

## 실행 명령

에이전트가 관찰 입력과 단계 증거를 준비한 뒤 스킬 폴더에서 실행한다.

```text
node scripts/run-pixel-workflow.cjs prepare /absolute/path/job.json /absolute/path/new-run
node scripts/run-pixel-workflow.cjs finalize /absolute/path/new-run /absolute/path/review.json
node scripts/run-pixel-workflow.cjs verify /absolute/path/new-run
```

`prepare`는 후보와 미검수 기록만 만든다. 직접 검수 후 `finalize`가 재현 검증을 거쳐 `delivery/native.png`, `display.png`, `receipt.json`을 저장한다. `verify`는 저장본·입력·코드 결속을 확인한다. 기존 실행 디렉터리를 덮어쓰지 않는다.

## 파일과 경로

증거 파일은 `{ "path": "/absolute/path/file.png", "sha256": "64자리 SHA256" }` 형태로 묶는다. 경로는 실행 컴퓨터의 절대 경로이며 파일 내용이 바뀌면 해시·해당 단계·후속 단계를 함께 갱신해야 한다. 계약에 과거 `redesign`, `measuredConversion`, `mode: scoped-repair`를 넣으면 차단한다.

`job.json`의 최소 형태는 다음과 같다. 값은 실제 계약과 일치해야 한다.

```json
{
  "contract": "/absolute/path/contract.json",
  "sampling": "source-region-area",
  "background": "#FFF7E6"
}
```

## contract.json

| 필드 | 의미 |
| --- | --- |
| `version`, `kind` | `1`, `character` 또는 `other` |
| `source`, `palette` | 픽셀 초안 PNG, 고정 팔레트 JSON의 파일 증거 |
| `width`, `height`, `scale` | native 가로/세로, 정수 표시 배율 1–8. 초안 크기는 `[width×scale, height×scale]` |
| `background`, `paletteCount`, `alpha` | 팔레트에 있는 배경색, 목록 색 수, 현재 생성 경로는 `opaque` |
| `displayTarget` | 실제 사용 크기·위치의 설명 |
| `sourceAssessment` | `status: READY_FOR_CONVERSION`, `representation: pixel-designed`, `sourceSha256`, 직접 관찰한 `observation` |
| `gridPlacement` | `mode: fixed-asset-grid`, `canvas`, `cell: scale`, `origin: [0,0]`, `sourceSha256` |
| `sourceToNative` | `scaleX/scaleY: 1/scale`, `offsetX/offsetY: 0` |
| `eyePolicy` | 눈의 실제 구성·원본 소유 영역·고정 역할색 |
| `formPolicy` | 선택적 원본 기반 필수 선 형태. 없으면 생략하거나 `null` |
| `outlinePolicy` | 외곽선을 사용하는 경우 아래의 공동 배치 정책 |
| `materialPlan` | 배정 계획 JSON의 파일 증거 |
| `pixelDecision`, `outlineDecision` | 선택한 규격과 이유. 외곽선 정식 경로는 `mode: continuous`, `width: 1`, `colorPolicy: darker-local-material` |
| `features` | `{id, sourceObservation, criterion}` 목록. 캐릭터는 `eyes/nose/mouth/skin/outline` 필수. 손·접촉 등 실제 필요한 항목을 추가 |
| `requiredFindings` | 사용자가 지적한 미해결 결함 ID 목록. 이후 검수에서 누락 금지 |
| `stageChecks` | `version: 3`, 1–4단계의 완료 기록. 해당 파일·실행 입력·배정표를 결속 |

부분 수정은 선택적으로 `baseline`, `allowedRects`, `protectedRects`를 선언하여 영역 밖 불변을 검사한다. 이 사각형은 **수정 범위 제한**이며 목적지 도트를 칠하는 지시가 아니다. 부분 수정의 기술적 불변을 형태 개선으로 보고하지 않는다.

팔레트는 `{ "colors": ["#FFF7E6", "#24242D", "..."] }`처럼 중복 없는 명시적 RGB 목록이다. `...`는 설명용이며 실제 입력에는 허용하지 않는다. 각 색이 어느 재질/역할에 쓰이는지 1단계 `colorGroups`에 기록한다. 팔레트가 부족하면 변환 중 색을 늘리지 말고 잠그기 전 계획을 수정한다.

## 원본 관찰 입력

### 눈

`eyePolicy`에는 `version: 1`, `visibility: visible|not-visible`, `observation`이 필요하다. 보이지 않는 눈에 가상의 눈을 만들지 않는다.

보이는 경우 `eyes`의 각 항목에 `name`, 원본 검색 `rect: [x,y,w,h]`, 실제 소유 `sourcePolygon`, `roles`, 반사 정책 `reflection: if-room|off`를 기록한다. 역할에는 `name`, 대표 `color`, 해당 역할의 팔레트 `colors`, 원본 RGB `samples`를 넣는다. 반사 역할 이름은 실행 모듈이 인식하는 `light`를 쓴다. 검색 사각형 전체를 눈으로 보호하지 않는다. 같은 다각형을 재질 계획의 보호 특징에도 전달한다.

### 외곽선

`outlinePolicy`의 필수 골격:

```json
{
  "layout": "joint-source-band",
  "width": 1,
  "background": "#FFF7E6",
  "colors": ["#24242D"],
  "sourceStrokeColors": ["#24242D"],
  "sourceInkRoles": [
    {
      "name": "관찰한 선 역할",
      "kind": "stroke",
      "color": "#24242D",
      "paletteColors": ["#24242D"],
      "observation": "실제 초안에서 확인한 근거"
    }
  ],
  "curveFlow": { "version": 1, "method": "anchored-source-curve" }
}
```

위 색은 예시다. 실제 초안의 선 색과 관찰을 사용한다. `kind: mixed`는 같은 색의 넓은 채움과 좁은 선을 구분해야 하는 경우다. 선택적 `sourceRect`도 원본 공간이다. `sourceStrokeColors`는 선언한 역할의 대표색과 정확히 일치해야 하며 한 안료를 두 역할에 중복 배정하지 않는다. `colors`에는 선 역할 밖의 관찰된 어두운 실루엣 재질이 포함될 수 있으나 근거 없이 추가하면 안 된다.

검사 범위는 선언된 원본 선 영역이다. `outsideDeclaredBand`를 전체 외곽선 검사 완료로 해석하지 않는다. 실제 선 누락·곡선 흐름·색면의 외부 노출을 초안과 별도로 비교한다.

### 재질

`materialPlan`이 가리키는 JSON:

- `version: 1`, `sourcePixelsSha256`: PNG 파일 해시가 아닌 **디코딩한 RGBA 바이트**의 SHA256.
- `paletteColors`: 팔레트 순서를 포함한 정확한 목록.
- `grid`: 키와 값은 `{native:[w,h], cell:s, canvas:[W,H], origin:[0,0]}`.
- `boundaryPolicySha256`: `material-assignment.cjs`의 `policyHash({eyePolicy, formPolicy, outlinePolicy})`로 만든 값. 없는 정책은 `null`로 전달한다.
- `observation`, `unassigned: preserve-existing-source-regions`.
- `regions`: `{id, material, polygon, colors, baseColor, boundaryRoles, observation}`. 원본 다각형 중복 금지, 피부 최대 3색, 기본색 필수.
- `protectedFeatures`: `{role, rect, sourcePolygon?, observation}`. 눈 다각형과 동일한 보호 형태를 사용한다.
- `inventory`: `{id, decision: assigned|preserved|absent, regionIds, observation}`. 전체 부위를 확인하며 미확인을 preserved로 바꾸지 않는다.

`compile(PNG, source, palette, width, height, plan, policies)`가 만든 `map`을 PNG로 저장하고 원본과 직접 비교한다. 분류가 잘못되면 계획을 고친 뒤 재생성한다. 최종 픽셀을 칠하여 계획 오류를 숨기지 않는다.

## 단계 기록

각 레코드는 `stage`, `name`, `status`, `reviewer`, `reference`, `input`, `output`, `palette`, `grid`, `evidence`, `checks`를 가진다. 필수 검사 키는 `stage-gates.cjs`의 `SEVEN_CHECKS`, 세부 관찰은 `detailChecksForStage`가 기준이다.

- 1단계: `colorGroups`, `execution: {version:1, route:fixed-asset-grid, sampling:source-region-area, operations:[...], fixedGridUserRequest:"사용자 조건과 선정 근거"}`. `operations`는 사용한 `eyePolicy/formPolicy/outlinePolicy/materialPlan`을 명시한다.
- 2단계: 서로 다른 격자의 실제 `native/expanded/outlineMask` 증거, 필수 경계 목록, 경계별 `coverage/width/continuity/flow/clearance` 관찰, 선택 이유를 `selection`에 기록한다. 스키마는 `assertCapacitySelection`에서 검증한다.
- 4단계: `executionOptions('fixed-asset-grid', contract)`와 `assignment: {plan, map}`. input/output은 같은 초안이다. source map은 실행 계획에서 재현되어야 한다.
- 5–7단계: 같은 격자·팔레트·배정표를 유지한다. 6단계 `action: modified|unchanged`는 실제 파일 차이와 일치해야 한다. 7단계는 이미지를 수정할 수 없다.

이전 단계 관찰을 뒤에서 새 결과에 맞춰 고쳐 쓰지 않는다. 변경이 필요하면 새 실행 디렉터리를 만든다.

## review.json과 납품

`prepare`의 `review.pending.json`을 별도 파일로 복사해 직접 관찰한 내용을 채운다. 최종 `stageChecks`에는 1–7단계를 넣으며 1–4단계는 실행 시점 계약과 같아야 한다.

`native/expanded`는 현재 후보 파일의 경로·해시다. `evidence` 항목에는 `id`, 파일 증거, `bindings: {source, native, baseline?}` 해시를 넣는다. `sourceReview`, `features`의 `clarity/fidelity`, `views.native/zoom/display` 관찰은 유효한 evidence ID를 인용해야 한다. 전체 이미지 항목 ID는 `$whole`이다.

보이는 눈은 `eyeReview.flatColors/shape/reflection`, 1도트 선은 `outline` 특징의 `boundary.continuity/thickness/staircase/colorSeparation`을 각각 검수한다. `findings`에서 결함이 `RESOLVED`이면 새 `verification`이 필요하다. `OPEN` 또는 미검증은 납품 차단 사유다.

테스트 파일의 합성 PASS 기록은 실제 이미지 검수에 복사하지 않는다. 기술 검사 결과와 원본 의미·형태에 대한 직접 관찰을 분리한다.
