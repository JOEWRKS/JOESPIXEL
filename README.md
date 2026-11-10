# JOESPIXEL

원본 이미지를 픽셀 아트로 만드는 Codex 스킬입니다.

## 설치

Node.js 20 이상과 이미지 생성 기능을 사용할 수 있는 Codex가 필요합니다.

1. [ZIP 다운로드](https://github.com/JOEWRKS/JOESPIXEL/archive/refs/heads/main.zip) 후 압축을 풉니다.
2. 폴더 이름을 `joewrks-pixel-art`로 바꾸고 `~/.codex/skills/`에 넣습니다.
3. 터미널에서 한 번 실행합니다.

```powershell
cd ~/.codex/skills/joewrks-pixel-art
npm ci --ignore-scripts
```

## 사용

Codex에서 새 대화를 열고 원본 이미지를 첨부한 뒤 요청합니다.

```text
$joewrks-pixel-art 이 이미지로 픽셀 아트 만들어줘.
```

원하는 크기·색상·스타일이 있으면 함께 적으세요.
