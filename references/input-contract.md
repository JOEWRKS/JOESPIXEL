# 실행 입력과 검수 기록

아래는 현재 지원 경로의 필드 안내다. 관찰 입력을 자동 생성하는 양식이나 PASS 템플릿이 아니다. 좌표는 명시된 원본 공간을 사용한다. 목적지 도트를 지정하여 그림을 덧칠하는 지시는 받지 않는다.

## 실행 명령

새 눈 입력은 `placement: "source-partitions"`(또는 측정 후 구성하는 `"source-construction"`, [설계](eye-construction-design.md)), `geometryPolicy: "source-stroke-fill"`을 함께 지정한다. 각 역할의 `geometry`는 `stroke`(선), `fill`(동공·홍채 등 면), `feature`(반사광 등) 중 하나다. 선만 `width: 1`을 요구한다. `closed: true`는 실제로 하나의 내부를 둘러싼 테두리에만 사용하며, 옆 무늬나 눈썹을 같은 테두리로 묶지 않는다. 같은 어두운 RGB라도 동공 면과 테두리는 공간 관찰로 구분한다. 입력 누락·선 연결/틈 손실·필수 면 소실은 차단한다.

눈 테두리의 소유 다각형은 원본 선 단면 전체를 포함해야 한다. 내부 색면에서 임의의 고정 폭만 넓혀 정하지 않는다. 닫힌 테두리 역할에는 필요시 `interiorRoles`로 실제 안쪽의 면·반사 역할 이름을 지정하여 바깥 피부/얼굴색 유입을 막는다. 출처 미정의 주변 잉크는 두께 검사에서 면제하지 않는다. 같은 색의 실제 주변 채움은 별도 눈 역할 또는 재질 계획의 `geometry: "fill"` 관찰로 구분한다.

눈의 `contextRoles`에는 홍채 관찰 영역의 가장자리에도 존재하는 피부·흰자 같은 `baseRoles`의 채움 역할만 지정한다. 이 역할은 경계 화소를 홍채색으로 강제하지 않도록 분류에 함께 참여한다. 보호 동공이나 선은 넣지 않는다. 같은 RGB가 동공/속눈썹 또는 반사/흰자에 쓰이면 해당 partition의 역할이 우선한다. 실제 눈 밖은 기존 재질 배정색을 이어받는다. `role.samplePoints`를 지정하면 `samples`와 같은 순서의 원본 정수 좌표 `[x,y]`를 넣는다. 현재 원본 RGB와 일치해야 하며, 재질에 해당하는 context 표본은 실제 소유 재질도 일치해야 한다. 새 원안에 옛 RGB나 머리 경계 표본을 피부색으로 재사용하지 않는다. 해당 지점이 그 역할에 속한다는 의미까지 관찰했다면 `role.verifySampleOwnership: true`를 함께 지정한다. 이 경우 samplePoints가 눈 소유 영역 안에서 실제로 그 역할로 분류돼야 하며, partition이 눈꺼풀·홍채 테두리를 다른 색 역할로 강제하면 격자 배치 전에 중단한다. 단순 색 표본은 이 옵션을 켜지 않으며 기존 분류 결과를 바꾸지 않는다.

`outlinePolicy.sourceInkRoles[].family`는 원본에서 이어지는 선의 서로 다른 색 역할에만 같은 이름을 준다. 연결 판단은 공유하되 각 역할의 색은 유지한다. 실제 배경 틈을 잇거나 주변 채움 면을 선으로 바꾸는 권한은 아니다. 미지정 입력은 기존 색별 연결 방식을 유지한다.

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

신규 원안은 비픽셀 일러스트다. `pixel-designed`와 `native-grid`는 새 제작 입구에서 차단한다. 정확한 native 파일을 재래스터화하지 않는다. 사용자 고정 크기는 `selection.mode: user-fixed`와 1단계 `execution.fixedGridUserRequest`로 묶고, 해당 격자의 실제 시험 PNG 한 세트와 모든 경계·용량 검수를 요구한다. 미지정 크기는 기존 후보 비교를 사용한다.

## contract.json

| 필드 | 의미 |
| --- | --- |
| `version`, `kind` | `1`, `character` 또는 `other` |
| `source`, `palette` | 생성한 설계 원안 PNG, 고정 팔레트 JSON의 파일 증거. `source`는 검수된 native 격자 초안이 아님 |
| `width`, `height`, `scale` | native 가로/세로, 정수 표시 배율 1–8. 원안 캔버스는 `[width×scale, height×scale]` |
| `background`, `paletteCount`, `alpha` | 팔레트에 있는 배경색, 목록 색 수, 현재 생성 경로는 `opaque` |
| `displayTarget` | 실제 사용 크기·위치의 설명 |
| `sourceAssessment` | `status: READY_FOR_CONVERSION`, `representation: illustration`, `sourceSha256`, 직접 관찰한 `observation` |
| `gridPlacement` | `mode: fixed-asset-grid`, `canvas`, `cell: scale`, `origin: [0,0]`, `sourceSha256` |
| `sourceToNative` | `scaleX/scaleY: 1/scale`, `offsetX/offsetY: 0` |
| `eyePolicy` | 눈의 실제 구성·원본 소유 영역·고정 역할색 |
| `formPolicy` | 선택적 원본 기반 필수 선 형태. 없으면 생략하거나 `null` |
| `outlinePolicy` | 외곽선을 사용하는 경우 아래의 공동 배치 정책 |
| `materialPlan` | 배정 계획 JSON의 파일 증거 |
| `pixelDecision`, `outlineDecision` | 선택한 규격과 이유. 외곽선 정식 경로는 `mode: continuous`, `width: 1`, `colorPolicy: darker-local-material` |
| `features` | `{id, sourceObservation, criterion, placement?}` 목록. 캐릭터는 `eyes/nose/mouth/skin/outline` 필수. 손·접촉 등 실제 필요한 항목을 추가. `placement`는 아래 참고 |
| `requiredFindings` | 사용자가 지적한 미해결 결함 ID 목록. 이후 검수에서 누락 금지 |
| `stageChecks` | `version: 4`, 1–5단계의 완료 기록. 해당 파일·실행 입력·배정표·공동 배치 증거를 결속 |

`features[].placement`는 그 특징을 격자가 **어떻게** 지키는지 밝힌다. 반 칸보다 얇은 내부 표식(코, 눈썹, 주름)은 면적 투표에서 지고, 목록에 기준이 있어도 아무 정책이 배치하지 않으면 조용히 사라진다.

- `{route:"formPolicy", feature:"<이름>"}`: `formPolicy`가 선언한 선. 실행 뒤 그 선의 칸이 0이면 중단.
- `{route:"measured", sourceRegion:[x,y,w,h], color:"#RRGGBB"}`: 일반 면적·외곽선 배치로 남는다고 관찰한 표식. 실행 뒤 영역 아래 칸에 그 색이 하나도 없으면 중단. 영역은 표식 자체에 둔다. 같은 색의 다른 선이 들어가면 검사가 무의미해진다.
- `{route:"omitted", reason:"..."}`: 이 격자에서 빼기로 한 결정. `run.json`의 `featurePlacement`에 남아 검수에서 보인다.

캐릭터의 `nose`·`mouth`는 경로가 필수다. 측정 통과는 표식이 남았다는 뜻일 뿐 바르게 읽힌다는 뜻이 아니다.

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

**잉크로 그린 홍채 테두리.** 애니메이션식 눈은 홍채 둘레를 외곽선과 같은 어두운 색으로 그리는 경우가 많다. 이 테두리가 어느 partition에도 속하지 않으면 `baseRoles`의 눈꺼풀 획으로 분류된다. 그러면 작은 눈에서 눈꺼풀 골격이 흰자와 홍채 사이를 세로로 가르거나, 원본에 없는 아래 테두리를 만들어 고리가 된다. 홍채 전체를 하나의 partition으로 두고 동공 역할을 함께 허용하면, 같은 RGB의 테두리가 보호 동공으로 들어가 동공이 커진다. 따라서 테두리를 포함한 홍채를 **동공을 둘러싼 고리 조각들**(왼쪽·오른쪽·아래 등 서로 겹치지 않는 다각형, 역할 `iris`, `iris-dark`, 필요하면 흰자·`light`)과 **중앙 동공 조각**(역할 `pupil`, 필요하면 `iris-dark`)으로 나눈다. 고리 조각에는 `pupil`을 허용하지 않으므로 테두리 화소는 가장 가까운 홍채 음영 역할로 분류된다. 흰자와 홍채 조각 사이에 틈을 남기지 않는다. 1~2px 틈의 테두리도 별도 눈꺼풀 성분이 된다.

**조각이 칠하지 않는 것.** 고리 조각이 눈의 바깥 윤곽선(흰자 너머의 검은 눈 테두리)이나 다각형 안으로 들어온 피부까지 덮어도, 그 화소가 모든 조각 역할보다 눈 주변 재질 색(눈 창 안, 다각형 밖에 한 칸 이상 있는 피부·외곽선 잉크)에 더 가까우면 주변 재질에 남는다(`partitionPixelsLeftToSurroundingMaterial`). 조각 역할과 같은 팔레트 색은 조각이 결정한다. 이 규칙은 홍채 테두리처럼 초록 기가 있는 어두운 색을 홍채 음영에 두고, 중성 검정 윤곽만 외곽선으로 돌린다. 중성 검정 홍채 테두리도 외곽선 잉크로 남을 수 있으므로 저장 칸에서 홍채 둘레를 확인한다.

실행 보호:

- 눈꺼풀 같은 획의 원본 성분 수를 셀 때 **한 칸 면적의 1/4 미만인 조각**(안티앨리어싱 점)은 제외하고 `ignoredSourceFragments`로 보고한다. 모든 조각이 작으면(작은 표식) 제외하지 않는다.
- `closed: false` 획의 원본 화소가 이미 내부를 둘러싸면 `Open stroke encloses a source interior`로 중단한다. 원인은 대개 위의 테두리다.
- 선택 역할(`required: false`)이어도 원본 면적이 **두 칸 이상**인데 배치에서 0칸이 되면 `erased an observed plane`으로 중단한다. 반사(`feature`)는 제외한다.
- 열린 눈꺼풀 획이 원본에서 **두 줄 두께**인 곳(경로가 비운 칸의 자기 잉크가 반 칸 이상이고, 옆 경로 칸과 합쳐 1.5칸 이상)이 있으면 `source mass of two rows`로 중단한다. 1도트 경로만 남기면 둘째 줄이 옆 채움(대개 어두운 홍채)으로 넘어가 굵은 눈꺼풀이 얇은 선과 넓은 홍채 띠가 된다. 원본을 보고 그 역할에 `thickness: "source"`(관찰된 둘째 줄을 같은 잉크의 면으로 유지, 외곽선색 면은 fill이라는 규칙과 같은 근거) 또는 `"one-dot"`(1도트로 얇게)을 지정한다. 두 경우 모두 해당 칸을 `thickStrokeCells`로 보고한다. 1.25칸 두께처럼 반올림하면 한 줄인 띠는 해당하지 않는다.
- 위상·고리 실패 메시지에는 원본 성분의 픽셀 수·범위(`sourceComponents`)와 배치 칸(`nativeCells`)이 들어간다. 다각형을 깎아 통과시키기 전에 그 성분이 실제로 무엇인지 원본에서 확인한다.

원본에서 확인한 축 방향의 조밀한 타원 동공에는 보호된 `fill` 역할에 `shape: "source-oval"`을 지정할 수 있다. 원본 역할 마스크의 폭·높이·중심을 공동 배치하며 흰자·반사·다른 보호 역할을 침범하거나 중심을 축별 반 칸 이상 이동해야 하면 차단한다. 모든 눈을 타원으로 강제하는 옵션이 아니며 원안 관찰 없이 사용하지 않는다. 동공이 칸 경계에 걸쳐 칸별 투표에서 어두운 홍채에 지면(원본 약 2칸 → 1칸) 이 옵션을 검토한다. 같은 색의 1/4칸 미만 안티앨리어싱 조각은 타원 형태 판단에서 제외하고 `ignoredSourceFragments`로 보고한다.

### 외곽선

닫힌 눈 테두리가 같은 색의 넓은 무늬와 붙어 있으면 stroke 역할에 `anchor: "interior"`와 `interiorRoles`를 명시할 수 있다. 관찰된 안쪽 면을 먼저 격자에 놓고 그 밖에 1도트 테두리를 함께 배치한다. 선의 전체 덩어리 중심선으로 눈 형태를 결정하지 않는다. 원본 선 범위를 벗어나거나 닫힘·연결을 유지할 수 없으면 차단한다. 열린 눈꺼풀이나 채움 눈에 자동 적용하지 않는다.

붙은 무늬는 같은 stroke 역할의 `attachedFill: {role, sourcePolygon, observation}`으로 관찰한다. `role`은 같은 출력색을 쓰는 별도 fill 역할이어야 한다. 실제 닫힌 테두리의 관찰 폭 밖이며 해당 소스 다각형 안에 있는 잉크만 그 fill로 넘긴다. 다각형 전체를 칠하거나 검사에서 면제하지 않는다. 테두리 안쪽 색이 바깥으로 나가거나 바깥 면색이 안쪽으로 들어가는 배치는 양쪽 모두 차단한다. 이 옵션 없는 기존 역할은 기존 배치 경로를 유지한다.

격자 칸이 눈 영역과 무늬 영역에 걸친 경우에도 `attachedFill`의 원본 관찰 창 안에서 이미 배정된 같은 잉크색만 무늬 역할로 집계한다. 창 밖의 소속 불명 잉크는 계속 중복 선 검사 대상이다. 닫힌 면 바깥의 비슷한 RGB를 홍채로 해석하지 않도록 `contextRoles`로 관찰된 외부 재질을 선언하며, 필요한 외부 역할이 없으면 중단한다.

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

**안쪽 선 색(`interiorShade`, 선택).** `outlinePolicy.interiorShade: [{material, color, observation}]`. 배치된 잉크 칸 중 상하좌우의 잉크 아닌 이웃이 모두 선언된 한 재질이고 8방향 이웃에 배경이 없는 칸은, 그 재질의 선언 색(재질 색 중 하나, 잉크 색 불가)으로 바뀐다. 바깥 윤곽, 서로 다른 재질 사이의 선, 눈·필수 특징 칸은 잉크로 남는다. 머리 가닥처럼 가는 안쪽 선이 많은 면에서, 8px 칸의 1칸 잉크가 바깥 윤곽과 같은 무게가 되어 잡음처럼 보일 때 쓴다. 적용 재질은 관찰자가 고르며 저장 감사도 같은 결정으로 검사한다(`interiorShade` 보고).

검사 범위는 선언된 원본 선 영역이다. `outsideDeclaredBand`를 전체 외곽선 검사 완료로 해석하지 않는다. 실제 선 누락·곡선 흐름·색면의 외부 노출을 초안과 별도로 비교한다.

`mixed` 재질의 외부 경계는 원본 전경 점유율에서 별도로 배치한다. 같은 색의 넓은 재질 면을 중심선으로 축소하지 않으며, 기존 외부 선 경로를 교체한다. 내부의 닫힌 틈과 고립된 선은 이 외부 경계 경로에 포함하지 않는다. `sourceExteriorRequired`가 있는 실행은 원본에서 계산한 `sourceExterior`의 점유·선색 검사까지 실행해야 통과하며, 새 경로/채움 기록과 저장본이 일치한다는 이유만으로 원안 형태 보존을 인정하지 않는다. 정수 격자의 모서리 단순화와 실제 인상은 별도 시각 검수 대상이다.

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

`regions`가 비어 있으면 재질 제약이 없어서, 색이 비슷한 다른 재질의 팔레트색이 고립 칸으로 섞인다(예: 가죽 주머니에 머리색, 렌치에 흰자색). 이를 막으려면 재질표를 관찰하고 `scripts/derive-material-regions.cjs`로 영역을 만든다.

- 재질표: `[{material, colors, baseColor, observation, lineMarks?}]`. 어느 팔레트색이 어느 재질을 이루는지만 적는다.
- 얇은 선 표식: 중심이 평평하지 않은 3~4px 선(코, 눈썹, 주름)은 평면 씨앗이 없어 주변 면 재질로 넘어간다. 그러면 색 배정에서 잉크가 아니게 되어 외곽선 배치가 보지 못한다. 선 재질에 `lineMarks: [{name, sourceRegion, samples, contextSamples, observation}]`를 관찰해 적으면, 영역 안에서 주변 표본보다 선 표본에 가까운 화소가 그 재질의 씨앗이 된다. 도구는 표식을 스스로 찾지 않는다. 표식이 외곽선에 붙어 있으면 `formPolicy`는 외곽선 가장자리까지 한 성분으로 잡혀 영역을 벗어나므로, 이 경로를 쓴다.
- 같은 표식은 공유색이라 씨앗이 없는 작은 면(다른 재질의 공유 회색과 같은 단추 중심)에도 쓴다. 생성기는 공유색만으로 된 평면 영역(기본 32px 이상)이 그 색을 갖지 않은 재질로 넘어가면 위치를 대며 중단하고, 팔레트에서 먼 평면 영역은 `offPaletteFlatAreas`로 보고한다. 보고된 영역이 원안의 실제 색이면 팔레트와 재질표에 추가하고, 그라데이션 중간톤이면 그대로 둔다.
- 공간 결정: 이어진 평면 영역마다 한 번 다수결로 재질을 정하고, 전이 화소(안티앨리어싱)는 가장 가까운 평면 영역을 따른다.
- 여러 재질이 쓰는 색: 씨앗에서 제외하고 주변을 따른다. 예: 흰 옷과 눈 흰자가 같은 색인 경우.
- 출력: `{regions, inventory}`를 계획에 넣고, 함께 나오는 지도 PNG를 원안과 대조한다.

이 도구는 의미를 인식하지 않는다. 재질표가 틀리면 영역도 틀린다.

```text
node scripts/derive-material-regions.cjs --source S.png --palette P.json --materials M.json --out regions.json --map map.png
```

관찰한 재질의 누락을 막으려면 `roleWitnesses: [{material, points:[[sourceX,sourceY],...], connected:true|false, observation}]`를 기록한다. 얼굴은 이마 위쪽과 아래쪽·볼·턱처럼 같은 피부 면에 속하는 실제 소스 지점을 포함한다. 지정 지점의 재질 배정이 빠졌거나 연결 조건이 깨지면 격자 배치 전에 중단한다. 이 검사는 지정한 소스 관찰 근거를 확인하며 자동 해부학 인식이나 전체 시각 검수를 대신하지 않는다.

`compile(PNG, source, palette, width, height, plan, policies)`가 만든 `map`을 PNG로 저장하고 원본과 직접 비교한다. 분류가 잘못되면 계획을 고친 뒤 재생성한다. 최종 픽셀을 칠하여 계획 오류를 숨기지 않는다.

특징 보호는 두 범위를 구분한다. 원본 색 배정에서는 실제 특징 다각형만 제외하고 같은 칸의 인접 재질은 계속 배정한다. 이후 격자 배치에서는 특징이 걸친 칸 전체를 보호한다. 눈 옆 흰 면이나 볼터치를 눈의 보호 범위와 혼동하지 않는다.

## 단계 기록

각 레코드는 `stage`, `name`, `status`, `reviewer`, `reference`, `input`, `output`, `palette`, `grid`, `evidence`, `checks`를 가진다. 순서는 `stage-gates.cjs`의 `EIGHT_NAMES`다. 공통 의미 검사는 기존 검증 함수를 재사용하지만, 신규 실행은 version 4만 허용한다.

- 1단계: `colorGroups`, `execution: {version:1, route:fixed-asset-grid, sampling:source-region-area, operations:[...], fixedGridUserRequest:"사용자 조건과 선정 근거"}`. `operations`는 사용한 `eyePolicy/formPolicy/outlinePolicy/materialPlan`을 명시한다. 사용자가 크기를 지정하지 않았으면 `fixedGridUserRequest` 대신 `sizeRequest: "unspecified"`를 쓴다. 지정하지 않은 요청 문장을 지어내지 않는다. 이 경우 4단계는 `selection.mode: compare`로 두 개 이상을 비교해야 하며 `user-fixed`는 차단된다.
- 2단계: 같은 요청에 따라 검수한 비픽셀 원안. 이 출력이 변환 source다.
- 3단계: `assignment: {plan, map}`. input/output은 같은 원안이다. source map은 실행 계획에서 재현되어야 한다.
- 4단계: 실제 `native/expanded/outlineMask` 후보, 필수 경계 목록, 경계별 `coverage/width/continuity/flow/clearance`와 선택 이유를 `selection`에 기록한다. 고정 크기는 하나, 미지정은 둘 이상을 시험한다. 후보 PNG는 같은 원안·캔버스·팔레트로 `node scripts/capacity-probe.cjs --source S.png --palette P.json --out DIR --background "#RRGGBB" --ink "#RRGGBB" 128x192 64x96`로 만든다. 출력의 판정은 `UNVERIFIED`이며 확대 PNG를 직접 보고 기록한다.
- 5단계: `executionOptions('fixed-asset-grid', contract)`와 `layout` JSON 파일 증거. `source-line-layout.evidence(PNG, source, palette, options)`가 만든 결과를 재실행하여 대조한다. `LAYOUT_CHECKS`의 각 시각 항목도 따로 확인한다. 계획이 없는 경우에도 실행 증거는 생략하지 않는다.
- 6단계: 실제 native 격자 초안. 7단계는 원안 대비 검수이며 이미지를 수정할 수 없다. 수정은 원인 단계로 돌아가 새 실행으로 한다.
- 8단계: finalize가 잠긴 PNG 복사·재읽기 후 저장 기록을 만든다. verify가 기록과 실제 파일을 다시 확인한다.

`materialPlan.lineLayouts`는 원안의 `sourcePolygon`, `paths`, `planes`를 받는다. 경로는 `id/points/color/priority/observation`, 면은 `id/polygon/axis/colors/observation`이다. 좌표는 원본 공간이다. `priority`는 `required` 또는 근거가 있는 `omit-subcell`이며, 면의 axis는 몸통에서 끝 방향의 원본 관찰이다. 목적지 칸·색 덧칠 지시는 차단한다. 기존 `surfaces` 영역과 중복할 수 없다. 코드가 머리 가닥을 자동 인식하는 것은 아니므로 이 관찰 입력이 필요한 사실을 보고한다.

이전 단계 관찰을 뒤에서 새 결과에 맞춰 고쳐 쓰지 않는다. 변경이 필요하면 새 실행 디렉터리를 만든다.

## review.json과 납품

`prepare`의 `diagnostics/`는 자동 생성되는 읽기용 중간 결과다. `trace.json`에 실제 실행 단계, PNG·픽셀 해시, 입력 결속과 변환 오류가 기록된다. 실패한 실행의 파일을 덮어쓰지 말고 새 실행 폴더를 사용한다. `BUILT`/변환 완료 상태는 시각 통과 또는 납품 승인이 아니다.

`prepare`의 `review.pending.json`을 별도 파일로 복사해 직접 관찰한 내용을 채운다. 검수 `stageChecks`에는 1–7단계를 넣으며 1–5단계는 실행 시점 계약과 같아야 한다. `gridDraft.native/expanded/grid`는 pending의 실제 격자 초안과 일치해야 한다. `gridDraft.sourceComparison`에는 원안에서 달라진 선 폭·형태·생략을, `gridDraft.visual`에는 격자 초안의 실제 외곽선·필수 형태 검수를 각각 기록한다. 두 관찰은 다른 시각 검사처럼 `{status, observation, evidence}` 형식이며 누락·미달이면 잠글 수 없다.

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


보호된 `source-oval` 동공은 가장 가까운 원본 중심 배치를 우선한다. 그 칸이 실제 배치된 눈꺼풀 선과 충돌할 때만, 동공 원본 잉크가 겹치는 같은 홍채 면의 인접 후보를 함께 검토한다. 크기를 늘리거나 선·흰자를 덮지 않고, 이동은 축별 1논리 칸 이내에서 원본 겹침과 중심 오차로 선택한다. `placement: source-supported-beside-stroke`와 실제 이동량을 보고하며, 이 수용력 검사도 시선·눈매의 시각 검수를 대신하지 않는다.


관찰된 둥근 홍채를 칸별 면적 투표가 납작하게 만들면 대표 홍채 역할에 `shape: "source-family-oval", protect: true`를 명시한다. 같은 family의 실제 원본 면적·가로세로 비율을 함께 사용해 작은 정수 격자 형태를 고르고, 눈꺼풀과 다른 필수 역할의 마지막 칸을 침범하지 않는다. 원본 홍채가 겹친 칸만 후보로 쓰며, 같은 면 안의 동공은 그 뒤에 배치한다. 기본 면적 투표가 필요한 다른 눈에는 자동 적용하지 않는다. 원본 분류가 조각나거나 배치할 공간이 없으면 중단하고, 원본의 모든 속눈썹·반사 복원으로 보고하지 않는다.
