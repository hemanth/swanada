# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `5.53%` (95% CI: [4.94%, 6.11%])
- **Overall Mean WER**: `26.15%` (95% CI: [23.77%, 28.53%])
- **Overall Mean RTF**: `0.0420x` (95% CI: [0.0396x, 0.0446x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 4.27% | [2.69%, 6.10%] | 22.99% | [15.41%, 32.21%] | 0.023x |
| Indian English | `en` | 40 | 212.1 | 6.23% | [4.67%, 7.92%] | 17.07% | [13.85%, 20.47%] | 0.035x |
| Hindi | `hi` | 40 | 190.2 | 2.20% | [1.45%, 3.03%] | 8.18% | [5.49%, 10.98%] | 0.024x |
| Kannada | `kn` | 40 | 204.8 | 5.21% | [3.88%, 6.88%] | 31.67% | [24.62%, 39.64%] | 0.035x |
| Marathi | `mr` | 40 | 168.5 | 5.72% | [3.19%, 8.34%] | 22.52% | [13.86%, 31.50%] | 0.044x |
| Bengali | `bn` | 40 | 210.6 | 5.95% | [4.37%, 7.59%] | 31.14% | [24.66%, 37.64%] | 0.054x |
| Tamil | `ta` | 40 | 167.7 | 7.56% | [6.01%, 9.11%] | 38.24% | [31.42%, 45.24%] | 0.042x |
| Telugu | `te` | 40 | 199.6 | 4.95% | [3.62%, 6.49%] | 29.83% | [22.28%, 38.12%] | 0.038x |
| Malayalam | `ml` | 40 | 158.7 | 6.16% | [4.10%, 8.27%] | 34.03% | [23.73%, 44.19%] | 0.043x |
| Gujarati | `gu` | 40 | 163.1 | 4.79% | [2.97%, 6.98%] | 19.28% | [13.26%, 25.98%] | 0.062x |
| Punjabi | `pa` | 40 | 162.9 | 6.35% | [3.52%, 9.78%] | 23.38% | [14.27%, 33.11%] | 0.049x |
| Odia | `or` | 40 | 151.9 | 6.93% | [4.91%, 9.41%] | 35.50% | [24.81%, 48.97%] | 0.054x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
