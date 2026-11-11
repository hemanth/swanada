# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `5.35%` (95% CI: [4.79%, 5.95%])
- **Overall Mean WER**: `25.08%` (95% CI: [22.68%, 27.45%])
- **Overall Mean RTF**: `0.0227x` (95% CI: [0.0215x, 0.0240x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 4.50% | [2.86%, 6.40%] | 24.95% | [16.60%, 34.25%] | 0.020x |
| Indian English | `en` | 40 | 212.1 | 3.94% | [2.76%, 5.13%] | 9.42% | [7.01%, 11.88%] | 0.024x |
| Hindi | `hi` | 40 | 190.2 | 2.55% | [1.61%, 3.61%] | 9.72% | [6.62%, 13.00%] | 0.020x |
| Kannada | `kn` | 40 | 204.8 | 6.09% | [4.36%, 8.18%] | 34.28% | [27.12%, 42.30%] | 0.024x |
| Marathi | `mr` | 40 | 168.5 | 5.82% | [3.56%, 8.54%] | 24.63% | [16.05%, 33.54%] | 0.024x |
| Bengali | `bn` | 40 | 210.6 | 4.71% | [3.45%, 6.09%] | 23.14% | [17.96%, 28.76%] | 0.022x |
| Tamil | `ta` | 40 | 167.7 | 6.86% | [5.19%, 8.65%] | 36.30% | [29.09%, 44.62%] | 0.024x |
| Telugu | `te` | 40 | 199.6 | 4.05% | [2.95%, 5.17%] | 25.82% | [17.87%, 33.30%] | 0.022x |
| Malayalam | `ml` | 40 | 158.7 | 5.92% | [3.71%, 8.37%] | 31.15% | [20.77%, 41.42%] | 0.024x |
| Gujarati | `gu` | 40 | 163.1 | 5.20% | [3.28%, 7.79%] | 21.73% | [15.20%, 29.36%] | 0.022x |
| Punjabi | `pa` | 40 | 162.9 | 7.46% | [4.68%, 11.38%] | 25.28% | [16.71%, 34.71%] | 0.022x |
| Odia | `or` | 40 | 151.9 | 7.13% | [5.06%, 9.83%] | 34.51% | [23.84%, 47.89%] | 0.023x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
