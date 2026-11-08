# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `5.43%` (95% CI: [4.85%, 6.01%])
- **Overall Mean WER**: `25.88%` (95% CI: [23.50%, 28.27%])
- **Overall Mean RTF**: `0.2407x` (95% CI: [0.2264x, 0.2578x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 4.27% | [2.69%, 6.10%] | 22.99% | [15.41%, 32.21%] | 0.276x |
| Indian English | `en` | 40 | 212.1 | 5.45% | [4.19%, 6.80%] | 15.82% | [12.99%, 18.82%] | 0.245x |
| Hindi | `hi` | 40 | 190.2 | 2.14% | [1.41%, 2.97%] | 8.04% | [5.40%, 10.88%] | 0.215x |
| Kannada | `kn` | 40 | 204.8 | 5.18% | [3.86%, 6.86%] | 31.39% | [24.49%, 39.27%] | 0.242x |
| Marathi | `mr` | 40 | 168.5 | 5.72% | [3.19%, 8.34%] | 22.52% | [13.86%, 31.50%] | 0.299x |
| Bengali | `bn` | 40 | 210.6 | 5.92% | [4.34%, 7.54%] | 30.98% | [24.62%, 37.53%] | 0.300x |
| Tamil | `ta` | 40 | 167.7 | 7.50% | [5.92%, 9.09%] | 38.12% | [31.30%, 45.01%] | 0.226x |
| Telugu | `te` | 40 | 199.6 | 4.79% | [3.48%, 6.33%] | 28.51% | [21.40%, 36.34%] | 0.216x |
| Malayalam | `ml` | 40 | 158.7 | 6.16% | [4.10%, 8.27%] | 34.03% | [23.73%, 44.19%] | 0.323x |
| Gujarati | `gu` | 40 | 163.1 | 4.79% | [2.97%, 6.98%] | 19.28% | [13.26%, 25.98%] | 0.315x |
| Punjabi | `pa` | 40 | 162.9 | 6.35% | [3.52%, 9.78%] | 23.38% | [14.27%, 33.11%] | 0.114x |
| Odia | `or` | 40 | 151.9 | 6.93% | [4.91%, 9.41%] | 35.50% | [24.81%, 48.97%] | 0.117x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
