# 음원 넣기 (ElevenLabs Sound Effects)

앱은 음원 없이도 완전히 동작합니다(무음). 파일을 넣으면 코드 수정 없이 인식됩니다.

1. ElevenLabs → Sound Effects에서 아래 프롬프트와 Duration으로 생성합니다. 루프는 `ambient-observatory`만 켭니다.
2. MP3로 내보내 `public/audio/` 에 **정확한 파일명**으로 저장합니다.
3. 앱 설정 화면(/settings)에서 상태가 "파일 있음"으로 바뀌는지 확인하고, 소리를 켠 뒤 "효과음 시험"으로 들어 봅니다.

| 파일 | 길이 | 재생 시점 | 기본 gain |
| --- | --- | --- | --- |
| ambient-observatory.mp3 | 24s 루프 | 설정에서 배경음 켤 때 | 0.07 |
| enter-expedition.mp3 | 1.2s | 탐사실 입장 성공 | 0.22 |
| ui-tap.mp3 | 0.15s | 점 선택, 증거 담기, 교사 단계 변경 | 0.16 |
| submit-confirm.mp3 | 0.6s | 서버 저장 확인 뒤 | 0.22 |
| evidence-reveal.mp3 | 1.8s | 화산 증거 카드가 처음 열릴 때 | 0.22 |
| boundary-reveal.mp3 | 2.2s | 판 경계 비교 카드가 처음 열릴 때 | 0.22 |
| report-ready.mp3 | 1.4s | 결과 정리 단계 진입 | 0.22 |
| gentle-attention.mp3 | 0.5s | 교사가 다음 활동·자료를 열었을 때(학생) | 0.18 |

프롬프트 전문은 제작 패키지의 `AUDIO_PROMPTS.txt`를 그대로 씁니다. 

정책: 기본 꺼짐, 명시적 "소리 켜기" 뒤에만 AudioContext 생성. 전체/효과음/배경음 음량 분리, 설정 저장. 같은 효과음은 500ms 안에 겹치지 않음. 지도 점·학생 제출마다 소리 내지 않음. 파일이 없거나 디코딩에 실패하면 `unavailable`로 표시하고 건너뜁니다. 실제 지진 소리나 실측 신호의 음향화가 아닙니다. ElevenLabs API를 실행 중 호출하지 않습니다.
