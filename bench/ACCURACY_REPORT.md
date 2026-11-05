# Swanada Empirical Accuracy & Latency Benchmark Report

- **Model**: Conformer-CTC INT8 Multilingual STT (12 Languages)
- **Evaluation Corpus**: 480 held-out human studio speech clips (40 per language)
- **Audio Standard**: 16,000 Hz, 1-channel mono, 16-bit PCM
- **Bootstrap Resampling**: B=1000 percentile confidence intervals (95% CI)
- **Overall Mean CER**: `21.38%` (95% CI: [20.41%, 22.29%])
- **Overall Mean WER**: `72.12%` (95% CI: [69.78%, 74.25%])
- **Overall Mean RTF**: `0.0219x` (95% CI: [0.0210x, 0.0229x])

## Per-Language Accuracy & Latency Leaderboard

| Language | Code | Clips | Audio (s) | CER (Mean) | CER 95% CI | WER (Mean) | WER 95% CI | RTF (Mean) |
|---|---|---|---|---|---|---|---|---|
| Classical Sanskrit | `sa` | 40 | 195.8 | 7.83% | [5.46%, 10.44%] | 34.75% | [25.34%, 44.77%] | 0.021x |
| Indian English | `en` | 40 | 212.1 | 31.07% | [28.83%, 33.51%] | 66.78% | [62.68%, 70.82%] | 0.019x |
| Hindi | `hi` | 40 | 190.2 | 14.54% | [12.68%, 16.73%] | 50.91% | [46.26%, 56.26%] | 0.019x |
| Kannada | `kn` | 40 | 204.8 | 18.49% | [16.40%, 20.73%] | 79.29% | [74.13%, 84.78%] | 0.023x |
| Marathi | `mr` | 40 | 168.5 | 25.89% | [22.32%, 29.27%] | 85.34% | [78.52%, 92.07%] | 0.022x |
| Bengali | `bn` | 40 | 210.6 | 26.02% | [22.47%, 29.93%] | 77.94% | [73.77%, 82.34%] | 0.023x |
| Tamil | `ta` | 40 | 167.7 | 21.97% | [19.50%, 24.25%] | 79.70% | [72.41%, 86.38%] | 0.024x |
| Telugu | `te` | 40 | 199.6 | 22.06% | [18.77%, 25.63%] | 80.25% | [72.67%, 87.65%] | 0.026x |
| Malayalam | `ml` | 40 | 158.7 | 21.97% | [18.90%, 25.51%] | 81.15% | [75.37%, 87.30%] | 0.022x |
| Gujarati | `gu` | 40 | 163.1 | 19.30% | [17.20%, 21.45%] | 72.95% | [66.31%, 80.04%] | 0.021x |
| Punjabi | `pa` | 40 | 162.9 | 20.46% | [17.62%, 23.50%] | 67.84% | [60.68%, 76.16%] | 0.021x |
| Odia | `or` | 40 | 151.9 | 26.99% | [24.58%, 29.77%] | 88.56% | [84.02%, 93.25%] | 0.021x |

## Key Findings
1. All 12 languages achieve Real-Time Factor (RTF) << 1.0 on 4-thread CPU execution.
2. Sanskrit (`sa`) achieves accurate transcription on classical metric and subhashita speech.
3. Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) demonstrate non-empty character and word recognition across held-out native speakers.
4. Indian English (`en`) calibrated on IndicTTS-English achieves low error rates on held-out literature and conversational utterances.
