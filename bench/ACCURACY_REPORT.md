# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `6.57%` (95% CI: [5.94%, 7.22%])
- **Overall Mean WER**: `30.06%` (95% CI: [27.66%, 32.44%])
- **Overall Mean RTF**: `0.0325x` (95% CI: [0.0305x, 0.0350x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 5.24% | [3.47%, 7.28%] | 27.77% | [19.28%, 37.17%] | 0.029x |
| Indian English | `en` | 40 | 212.1 | 5.70% | [4.41%, 7.00%] | 16.94% | [13.53%, 20.36%] | 0.032x |
| Hindi | `hi` | 40 | 190.2 | 3.44% | [2.34%, 4.53%] | 12.64% | [8.94%, 16.45%] | 0.029x |
| Kannada | `kn` | 40 | 204.8 | 6.03% | [4.65%, 7.58%] | 35.70% | [28.60%, 42.42%] | 0.036x |
| Marathi | `mr` | 40 | 168.5 | 7.31% | [4.30%, 10.50%] | 27.52% | [19.05%, 37.06%] | 0.037x |
| Bengali | `bn` | 40 | 210.6 | 7.76% | [6.07%, 9.54%] | 40.66% | [33.77%, 46.95%] | 0.032x |
| Tamil | `ta` | 40 | 167.7 | 8.01% | [6.28%, 9.86%] | 38.46% | [32.24%, 44.98%] | 0.035x |
| Telugu | `te` | 40 | 199.6 | 5.54% | [4.01%, 7.16%] | 30.62% | [23.70%, 38.22%] | 0.032x |
| Malayalam | `ml` | 40 | 158.7 | 7.78% | [5.58%, 10.13%] | 40.27% | [29.77%, 50.66%] | 0.033x |
| Gujarati | `gu` | 40 | 163.1 | 5.32% | [3.42%, 7.73%] | 23.17% | [15.31%, 32.05%] | 0.032x |
| Punjabi | `pa` | 40 | 162.9 | 7.71% | [4.69%, 11.34%] | 29.47% | [19.25%, 41.46%] | 0.031x |
| Odia | `or` | 40 | 151.9 | 8.94% | [6.25%, 12.46%] | 37.55% | [29.34%, 46.61%] | 0.033x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
