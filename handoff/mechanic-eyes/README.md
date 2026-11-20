# mechanic-eyes — 실제 생성 원안의 얼굴 축약본

원안: 오리지널 검수용 캐릭터(Higgsfield `gpt_image_2_6`, 2026-11-20). 1360×2048로 생성해 1024×1536 캔버스에 맞췄다(0.75 면적 축소, 좌우 2px 여백). `face.png`는 그 캔버스의 x384–576, y128–256(8px 칸 정렬)이다.

`case.json`의 두 눈 입력:

- `rimInBase`: 홍채 전체를 한 partition으로 두어 잉크 테두리가 눈꺼풀 base 역할에 남는 입력. 77e9247에서는 왼쪽 눈이 검은 덩어리로 배치됐다. 현재 코드는 `erased an observed plane`으로 중단한다.
- `rimInRing`: 테두리를 홍채 고리 조각에, 동공을 중앙 조각에 둔 입력. 모든 관찰 면이 남는다.

`scripts/test-eye-hardening.cjs`가 이 축약본을 사용한다. 관찰 좌표는 이 원안 전용이며 공용 코드의 분기가 아니다.
