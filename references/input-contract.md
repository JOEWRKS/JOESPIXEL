# 실행 입력과 검수 기록

아래는 현재 지원 경로의 필드 안내다. 관찰 입력을 자동 생성하는 양식이나 PASS 템플릿이 아니다. 좌표는 명시된 원본 공간을 사용한다. 목적지 도트를 지정하여 그림을 덧칠하는 지시는 받지 않는다.

## 실행 명령

새 눈 입력은 `placement: "source-partitions"`, `geometryPolicy: "source-stroke-fill"`을 함께 지정한다. 각 역할의 `geometry`는 `stroke`(선), `fill`(동공·홍채 등 면), `feature`(반사광 등) 중 하나다. 선만 `width: 1`을 요구한다. `closed: true`는 실제로 하나의 내부를 둘러싼 테두리에만 사용하며, 옆 무늬나 눈썹을 같은 테두리로 묶지 않는다. 같은 어두운 RGB라도 동공 면과 테두리는 공간 관찰로 구분한다. 입력 누락·선 연결/틈 손실·필수 면 소실은 차단한다.

입 같은 내부 선은 `formPolicy.placement: "source-path"`로 원본 경로와 인접 면을 배치한다. 눈과 내부 선이 같은 격자 칸을 요구하면 차단한다. 원본 영역·색 역할 관찰은 여전히 필요하며, 이름으로 캐릭터를 판별하거나 목적지 도트를 지정하지 않는다. 과거 입력의 저수준 재현은 유지하지만 새 제작의 필수 검사를 우회하지 못한다.

`source-path`의 필수 열린 선에는 `feature.curve`가 필요하다: `{version:1, axis:"y", observation:"원본 형태 관찰", landmarks:[...]}`. `axis`는 굽힘 높이를 비교할 원본 축(`x` 또는 `y`)이다. 각 landmark는 `{name, kind, sourceRegion:[x,y,w,h]}`이며, 처음/마지막은 `endpoint`, 중간은 해당 축의 `min`(봉우리) 또는 `max`(굽힘)다. 창은 원본의 의미 있는 지점을 둘러싸며 목적지 도트나 강제 출력 폭을 입력하지 않는다. 바닥 폭은 원본에서 계산한다. 양끝은 관찰된 선 끝까지 유지하고, 중간 굽힘 후보는 원본 잉크 안에서 한 논리 칸 거리 이내로 공동 선택한다. 보고서의 선택 위치·원본 대비 이동·곡선 순서를 직접 검수한다. 닫힌 눈 테두리·동공 면·입 내부 색면을 이 열린 선 방식에 넣지 않는다. 기존 필수 `source-path` 입력도 새 실행 전 이 관찰을 추가해야 하며, 누락 시 자동 보호로 대체하지 않는다.

선 화소는 `samples`와 `contextSamples` 중 가까운 쪽으로 분류한다. 따라서 `contextSamples`에는 검색 창 안에서 선에 닿는 **모든 비선 색**을 넣는다. 입 선이면 피부와 함께 위·아래 입술 색을 모두 넣는다. 피부보다 어두운 입술 색이 빠지면 입술 면이 선으로 분류되어 창 가장자리까지 이어지고 `search-region-clips-source`로 중단된다. 그리고 `sourceRegion`은 선 성분의 사방에 비선 화소를 최소 1원본 화소 이상 남겨야 한다. 보고서의 `edges`가 닿은 가장자리를 알려 준다. 그 방향에 실제 선이 이어지면 창을 넓히고, 선이 창 안에서 끝나는데도 닿았다면 그 쪽의 인접 색을 `contextSamples`에 추가한다. 창을 줄여 다른 면을 잘라내는 방식으로 통과시키지 않는다.

에이전트가 관찰 입력과 단계 증거를 준비한 뒤 스킬 폴더에서 실행한다.

```text
node scripts/run-pixel-workflow.cjs prepare /absolute/path/job.json /absolute/path/new-run
node scripts/run-pixel-workflow.cjs lock /absolute/path/new-run /absolute/path/review.json
node scripts/run-pixel-workflow.cjs finalize /absolute/path/new-run /absolute/path/review.json
node scripts/run-pixel-workflow.cjs verify /absolute/path/new-run
```

`prepare`는 실제 격자 초안과 미검수 기록을 만든다. 직접 검수 후 `lock`이 변환 재현과 선 검사를 통과한 PNG를 `locked-draft/`에 고정한다. `finalize`는 그 PNG를 그대로 복사해 `delivery/native.png`, `display.png`, `receipt.json`을 저장한다. `verify`는 잠금·입력·코드 결속과 실제 저장 도트 배열의 동일성을 확인한다. 잠금 후 변환/리사이즈를 재실행하지 않으며 기존 실행을 덮어쓰지 않는다. 잠금 없는 과거 실행은 새 `prepare`가 필요하다.

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
| `source`, `palette` | 생성한 설계 원안 PNG, 고정 팔레트 JSON의 파일 증거. `source`는 검수된 native 격자 초안이 아님 |
| `width`, `height`, `scale` | native 가로/세로, 정수 표시 배율 1–8. 원안 캔버스는 `[width×scale, height×scale]` |
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

새 제작의 보이는 눈은 `placement: source-partitions`가 필수다. 과거 색 정리 방식은 기존 입력 재현용이며 새 제작 입구에서 차단한다. 역할 분할은 색 배정용이며 공간 분리 명령이 아니다. 원본에서 가까운 위쪽 획과 눈 테두리 사이에 최소 흰 칸 수를 일괄 요구하지 않는다. 관찰에는 원본의 접촉/근접/분리 관계를 명시하고, 설계 원안이 이를 바꾸면 배정 전에 반려한다.

- 각 눈의 `partitions`에 `{name, sourcePolygon, roles: [역할 이름], observation}`을 기록한다. 홍채 영역은 어두운 동공·홍채 음영·반사를 포함하되 실제 눈꺼풀을 침범하지 않는다. 분할 밖에 적용할 역할 이름은 `baseRoles`로 지정한다. 실제 소스 픽셀에서 분할이 겹치면 실행을 차단한다.
- 역할의 `family`는 먼저 칸을 배정받을 동일한 형태다. 홍채의 기본색·음영·동공·반사는 같은 홍채 family로 묶고, 눈꺼풀·흰자·피부와 구분한다. family가 차지할 칸을 정한 후 그 안의 역할색을 선택한다. 전체 면적 할당량으로 색을 다른 위치에 이동하지 않는다.
- `samples`는 원본에서 관찰한 RGB다. 출력 팔레트의 색을 원본 표본으로 대신하거나, 같은 어두운 색이라는 이유로 눈꺼풀과 동공을 합치지 않는다. 공간 분할이 구별하므로 역할 간 같은 출력색은 허용한다. 필수 역할은 `required: true`, 반사 때문에 지워서는 안 되는 동공 등은 `protect: true`로 지정한다. 선택적 역할만 `required: false`로 둔다.
- `applyEyePolicy`가 반환한 `sourceRoleMap`을 실제 원안과 먼저 대조한다. 위쪽 속눈썹까지 눈 소유 영역에 들어가는지, 홍채 경계·동공·반사가 올바른 역할인지 확인한다. 원본 관찰 경로이며 목적지 도트 지정이나 자동 해부학 인식이 아니다. 단순한 점눈도 관찰된 하나의 형태로 명시하며 홍채를 새로 만들지 않는다.
- 중앙 동공과 홍채 가장자리가 같은 어두운 색이면 RGB 표본만으로 구별하지 않는다. 관찰된 중앙 영역과 주변 홍채를 겹치지 않는 소스 `partitions`로 나누고, 동공 역할은 실제 중앙 영역에서만 허용한다. 색의 존재와 별개로 원본의 동공 위치·홍채 비율을 비교한다.

원본에서 확인한 축 방향의 조밀한 타원 동공에는 보호된 `fill` 역할에 `shape: "source-oval"`을 지정할 수 있다. 원본 역할 마스크의 폭·높이·중심을 공동 배치하며 흰자·반사·다른 보호 역할을 침범하거나 중심을 축별 반 칸 이상 이동해야 하면 차단한다. 모든 눈을 타원으로 강제하는 옵션이 아니며 원안 관찰 없이 사용하지 않는다.

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

`joint-source-band`는 `formPolicy`의 필수 선을 소유권으로 받아 함께 배치하므로 `mode`가 필요 없다. 사용하지 않는 `mode`를 통과용으로 넣지 않는다. `mode: "source-silhouette-width"`는 `layout`이 없는 구 외곽선 경로에서만 필수 선과 함께 요구된다.

검사 범위는 선언된 원본 선 영역이다. `outsideDeclaredBand`를 전체 외곽선 검사 완료로 해석하지 않는다. 실제 선 누락·곡선 흐름·색면의 외부 노출을 초안과 별도로 비교한다.

### 재질

`materialPlan`이 가리키는 JSON:

- `version: 1`, `sourcePixelsSha256`: PNG 파일 해시가 아닌 **디코딩한 RGBA 바이트**의 SHA256.
- `paletteColors`: 팔레트 순서를 포함한 정확한 목록.
- `grid`: 키와 값은 `{native:[w,h], cell:s, canvas:[W,H], origin:[0,0]}`.
- `boundaryPolicySha256`: `material-assignment.cjs`의 `policyHash({eyePolicy, formPolicy, outlinePolicy})`로 만든 값. 없는 정책은 `null`로 전달한다.
- `observation`, `unassigned: preserve-existing-source-regions`.
- `regions`: `{id, material, polygon, colors, baseColor, boundaryRoles, observation, geometry?}`. 원본 다각형 중복 금지, 피부 최대 3색, 기본색 필수. `geometry: "fill"`은 선과 같은 색을 쓰는 **실제 채움 면**을 원본 좌표에서 명시한다. 배경·선 역할과 중복 지정할 수 없으며 `joint-source-band`에서만 지원한다. 해당 표본은 선 추출·연결 복구·접촉선 탐색의 잉크로 쓰지 않고 재질 면적 배정에 사용한다. 한 칸의 과반을 차지하는 명시 면은 저장본의 허용 재질색도 검사한다. 주변 윤곽 검사는 면제하지 않는다.
- `protectedFeatures`: `{role, rect, sourcePolygon?, observation}`. 눈 다각형과 동일한 보호 형태를 사용한다.
- `inventory`: `{id, decision: assigned|preserved|absent, regionIds, observation}`. 전체 부위를 확인하며 미확인을 preserved로 바꾸지 않는다.

관찰한 재질의 누락을 막으려면 `roleWitnesses: [{material, points:[[sourceX,sourceY],...], connected:true|false, observation}]`를 기록한다. 얼굴은 이마 위쪽과 아래쪽·볼·턱처럼 같은 피부 면에 속하는 실제 소스 지점을 포함한다. 지정 지점의 재질 배정이 빠졌거나 연결 조건이 깨지면 격자 배치 전에 중단한다. 이 검사는 지정한 소스 관찰 근거를 확인하며 자동 해부학 인식이나 전체 시각 검수를 대신하지 않는다.

`compile(PNG, source, palette, width, height, plan, policies)`가 만든 `map`을 PNG로 저장하고 원본과 직접 비교한다. 분류가 잘못되면 계획을 고친 뒤 재생성한다. 최종 픽셀을 칠하여 계획 오류를 숨기지 않는다.

특징 보호는 두 범위를 구분한다. 원본 색 배정에서는 실제 특징 다각형만 제외하고 같은 칸의 인접 재질은 계속 배정한다. 이후 격자 배치에서는 특징이 걸친 칸 전체를 보호한다. 눈 옆 흰 면이나 볼터치를 눈의 보호 범위와 혼동하지 않는다.

## 단계 기록

각 레코드는 `stage`, `name`, `status`, `reviewer`, `reference`, `input`, `output`, `palette`, `grid`, `evidence`, `checks`를 가진다. 필수 검사 키는 `stage-gates.cjs`의 `SEVEN_CHECKS`, 세부 관찰은 `detailChecksForStage`가 기준이다.

- 1단계: `colorGroups`, `execution: {version:1, route:fixed-asset-grid, sampling:source-region-area, operations:[...], fixedGridUserRequest:"사용자 조건과 선정 근거"}`. `operations`는 사용한 `eyePolicy/formPolicy/outlinePolicy/materialPlan`을 명시한다.
- 2단계: 서로 다른 격자의 실제 `native/expanded/outlineMask` 증거, 필수 경계 목록, 경계별 `coverage/width/continuity/flow/clearance` 관찰, 선택 이유를 `selection`에 기록한다. 스키마는 `assertCapacitySelection`에서 검증한다.
- 4단계: `executionOptions('fixed-asset-grid', contract)`와 `assignment: {plan, map}`. input/output은 같은 초안이다. source map은 실행 계획에서 재현되어야 한다.
- 5–7단계: 같은 격자·팔레트·배정표를 유지한다. 6단계 `action: modified|unchanged`는 실제 파일 차이와 일치해야 한다. 7단계는 이미지를 수정할 수 없다.

이전 단계 관찰을 뒤에서 새 결과에 맞춰 고쳐 쓰지 않는다. 변경이 필요하면 새 실행 디렉터리를 만든다.

## review.json과 납품

`prepare`의 `diagnostics/`는 자동 생성되는 읽기용 중간 결과다. `trace.json`에 실제 실행 단계, PNG·픽셀 해시, 입력 결속과 변환 오류가 기록된다. 실패한 실행의 파일을 덮어쓰지 말고 새 실행 폴더를 사용한다. `BUILT`/변환 완료 상태는 시각 통과 또는 납품 승인이 아니다.

`prepare`의 `review.pending.json`을 별도 파일로 복사해 직접 관찰한 내용을 채운다. 최종 `stageChecks`에는 1–7단계를 넣으며 1–4단계는 실행 시점 계약과 같아야 한다. `gridDraft.native/expanded/grid`는 pending의 실제 격자 초안과 일치해야 한다. `gridDraft.sourceComparison`에는 원안에서 달라진 선 폭·형태·생략을, `gridDraft.visual`에는 격자 초안의 실제 외곽선·필수 형태 검수를 각각 기록한다. 두 관찰은 다른 시각 검사처럼 `{status, observation, evidence}` 형식이며 누락·미달이면 잠글 수 없다.

`native/expanded`는 현재 후보 파일의 경로·해시다. `evidence` 항목에는 `id`, 파일 증거, `bindings: {source, native, baseline?}` 해시를 넣는다. 전체 이미지 항목 ID는 `$whole`이다.

최종 검수의 각 관찰은 `{status, observation, evidence, comparison}`을 가진다. `comparison`은 `{sourceRegion:[x,y,w,h], difference, criterion, reason}`이며 실제 원안 좌표, 관찰한 차이, 적용 기준, 판정 이유를 각각 적는다. `sourceReview`, 격자 비교, 눈 검사, 특징의 clarity/fidelity·외곽선 검사, 실제 표시 크기와 결함 해결 기록에 같은 형식을 적용한다. 증거 ID는 현재 원안·출력에 결속되어야 한다. 누락된 비교와 동일 비교문 복사로 만든 중복 검수는 잠금을 차단한다. 이 구조 검사가 관찰 내용의 진실을 자동 판정하는 것은 아니다.

보이는 눈은 `eyeReview.flatColors/shape/reflection`, 1도트 선은 `outline` 특징의 `boundary.continuity/thickness/staircase/colorSeparation`을 각각 검수한다. `findings`에서 결함이 `RESOLVED`이면 새 `verification`이 필요하다. `OPEN` 또는 미검증은 잠금과 납품 차단 사유다. `lock` 이후 검수 파일도 변경할 수 없다. 저장 후 확인한 `draftPreservation`은 잠긴 격자 초안과 최종본의 동일성만 뜻하며 생성 원안의 두께 보존이나 시각 품질을 대신하지 않는다.

테스트 파일의 합성 PASS 기록은 실제 이미지 검수에 복사하지 않는다. 기술 검사 결과와 원본 의미·형태에 대한 직접 관찰을 분리한다.
# 연결된 면과 범위가 고정된 수정

`materialPlan.surfaces`는 원본에서 같은 연결 면임을 확인한 관찰 조각만 묶는다. 각 항목은 `id`, `regionIds`, `contourColor`, `observation`을 가진다. 같은 색이라는 이유로 별개의 물체를 합치지 않는다. `materialGroups/colorInterior`는 동일 재질 계약의 색 제약이고, `regionGroups/interior/surfaces`는 기하 소유권이다. 재질 조각 수 때문에 색 검사가 빠지지 않으며 색 제약만으로 윤곽을 강제 연결하지 않는다. 실제 source map과 원안을 대조한다.

변환과 저장 검증은 동일한 `resolveSourcePlanes`를 사용한다. 재질 제약 → 연결 색 면 분할 → 실제 눈 표본 보존으로 만든 `sourceLabels`가 면·눈/입 주변·경계 채움에 전달된다. 후속 단계에서 독립적인 재질 RGB 재배정 경로를 만들지 않는다. 원본 관찰이 없는 부분과 실제 눈 내부 역할은 별도 관찰 규칙을 유지한다.

같은 원안의 부분 수정은 `materialPlan.preserveOutside`로 변경 범위를 고정할 수 있다. 필드는 `baseline`과 `baselineRun`(각각 절대 경로·SHA256), `sourcePixelsSha256`, 원본 좌표의 `sourceRegions`, `observation`이다. 기준 PNG와 실행 기록이 같은 원안·격자·팔레트에 속하는지 검증한다. 범위 밖은 쓰기 불변 조건이며 **기하 배치의 장애물이나 선 두께 검사의 예외가 아니다**. 기존 실행의 선·채움 근거를 합쳐 최종 PNG 전체를 검사한다. 새 원안에 이전 보존 계약을 재사용할 수 없다.

이미지 도구로 원안 일부를 편집한 경우에는 현재 원안 해시로 새 계획을 만들고 `preserveOutside.sourceEdit: {baselineSourcePixelsSha256, observation}`을 명시할 수 있다. 기준 실행의 원안 파일·디코딩 해시, 동일 캔버스·팔레트, 격자에 맞춘 편집 사각형을 확인하며 **사각형 밖 원안 RGBA가 한 픽셀이라도 바뀌면 차단**한다. 이 검증을 통과한 영역 밖만 이전 실행의 픽셀과 선 검사 근거를 유지한다. 새 원안 전체를 과거 계약으로 위장하거나 검수하지 않은 최종 도트를 합성하는 경로가 아니다.

내부 곡선의 `curve.flow: "smooth"`는 원본에서 둥근 진행이 확인된 경우만 사용한다. 양끝과 중간 경로를 같은 원본 중심선 기준으로 공동 평가하며, 방향 변화가 적다는 이유로 원본 굽힘을 펴지 않는다. 끝의 길이 범위·관찰 지점 사이 상승/하강·극점과 굽힘 폭은 유지한다. 원본의 양끝·극점 관찰이 필요하고, 모서리나 굽힘을 생략하는 옵션이 아니다. 모든 좌표는 원본 관찰용이며 목적지 도트 지정과 저장본 덧칠은 허용하지 않는다.

`smooth` 곡선은 소스 중심선과의 거리도 평가하고, 끝의 길이 방향 범위를 유지하면서 실제 잉크가 걸친 인접 행/열 중 전체 흐름에 맞는 끝점을 함께 선택한다. 격자 경계에 걸친 가장 바깥 픽셀을 무조건 고정해 돌출시키지 않는다. `smooth`가 아닌 모서리 끝점은 원래 끝 범위를 유지한다.
