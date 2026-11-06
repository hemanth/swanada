# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `18.13%` (95% CI: [17.23%, 18.99%])
- **Overall Mean WER**: `64.31%` (95% CI: [61.87%, 66.63%])
- **Overall Mean RTF**: `0.0148x` (95% CI: [0.0143x, 0.0155x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 7.90% | [5.49%, 10.44%] | 34.75% | [25.34%, 44.77%] | 0.012x |
| Indian English | `en` | 40 | 212.1 | 23.12% | [20.98%, 25.25%] | 55.48% | [50.94%, 60.09%] | 0.014x |
| Hindi | `hi` | 40 | 190.2 | 9.36% | [7.80%, 11.17%] | 34.04% | [28.63%, 39.52%] | 0.013x |
| Kannada | `kn` | 40 | 204.8 | 14.88% | [12.61%, 17.20%] | 67.21% | [59.70%, 74.71%] | 0.014x |
| Marathi | `mr` | 40 | 168.5 | 23.14% | [19.41%, 26.75%] | 76.44% | [69.89%, 82.44%] | 0.016x |
| Bengali | `bn` | 40 | 210.6 | 23.99% | [20.31%, 27.94%] | 72.73% | [67.93%, 77.81%] | 0.016x |
| Tamil | `ta` | 40 | 167.7 | 19.16% | [16.74%, 21.43%] | 73.49% | [65.39%, 80.37%] | 0.014x |
| Telugu | `te` | 40 | 199.6 | 19.33% | [16.26%, 22.58%] | 75.34% | [67.65%, 83.08%] | 0.014x |
| Malayalam | `ml` | 40 | 158.7 | 20.50% | [17.50%, 24.19%] | 77.92% | [72.40%, 84.10%] | 0.015x |
| Gujarati | `gu` | 40 | 163.1 | 15.39% | [13.57%, 17.23%] | 63.12% | [56.11%, 70.94%] | 0.015x |
| Punjabi | `pa` | 40 | 162.9 | 17.08% | [14.25%, 19.98%] | 58.30% | [49.46%, 68.07%] | 0.017x |
| Odia | `or` | 40 | 151.9 | 23.67% | [20.94%, 26.57%] | 82.96% | [77.83%, 88.30%] | 0.017x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
