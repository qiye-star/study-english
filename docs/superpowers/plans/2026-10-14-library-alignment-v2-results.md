# 跟读库句边界 v2 · 结果与核对(plans/2026-10-14-library-alignment-v2.md)

只写数字、字段名与结论;不写转写文字、标题、密钥、URL。

## Task 0 词级时间探针

- 日期 / 基于提交:2026-10-14 / 078f5b52(脚本与测试)
- 识别路径:火山流式识别(`Settings().asr_stream_*`,经运行中的容器;不写密钥与主机)
- 素材:已导入库视频(约 912 s)里用 ffmpeg 切出的两段 60 s:A = 从 0 s 开始(开头持续背景音乐),B = 从 420 s 开始(说话中段);16 kHz 单声道 mp3。每段 3 次请求(整段 + 两个半段)。用户已在对话里明确同意(「开始执行所有计划」)。运行后已删除容器里的 `/tmp` 临时文件;未重建 / 重启容器。

### 素材 A-music(音频 60.0 s)

- 字段:utterance additions, definite, end_time, start_time, text, words;words end_time, start_time, text;additions fixed_prefix_result, source, speaker_id
- 词:utterances 6;words 225;utterances_with_words 6;words_inside_their_utterance 113;words_monotonic False;time_grid_ms 1;dur_p5 0.0;dur_p50 40.0;dur_p95 280.0;dur_zero 112;dur_under_30 0;dur_over_1500 0;gap_p50 0.0;gap_p90 53091.0;gap_p99 58891.0;gaps_over_1000 108;gaps_over_2000 108;inner_max_gap_p50 47481.0;inner_max_gap_max 59731.0;word_punct 5;token_word_match 1.0;definite_false 0
- v1 句边界离词的距离(ms):v1_sentences 7;v1_empty 0;v1_with_gap_over_1500 0;v1_edge_p50 0.0;v1_edge_p95 491.0;v1_edge_max 491.0;v1_edges_over_300 1
- 接缝(两半各多听 1 s):seam_words_whole 4;seam_matched_left 3;seam_matched_right 4;jitter_p50 0.0;jitter_p95 80.0;jitter_max 80.0;left_edge_word_cut False


### 素材 B-mid-speech(音频 60.0 s)

- 字段:utterance additions, definite, end_time, start_time, text, words;words end_time, start_time, text;additions fixed_prefix_result, source, speaker_id
- 词:utterances 3;words 118;utterances_with_words 3;words_inside_their_utterance 62;words_monotonic False;time_grid_ms 1;dur_p5 0.0;dur_p50 40.0;dur_p95 280.0;dur_zero 56;dur_under_30 0;dur_over_1500 0;gap_p50 0.0;gap_p90 57641.0;gap_p99 59481.0;gaps_over_1000 56;gaps_over_2000 56;inner_max_gap_p50 0.0;inner_max_gap_max 59601.0;word_punct 3;token_word_match 0.966;definite_false 0
- v1 句边界离词的距离(ms):v1_sentences 3;v1_empty 0;v1_with_gap_over_1500 0;v1_edge_p50 0.0;v1_edge_p95 280.0;v1_edge_max 280.0;v1_edges_over_300 0
- 接缝(两半各多听 1 s):seam_words_whole 0;seam_matched_left 0;seam_matched_right 0;jitter_p50 None;jitter_p95 None;jitter_max None;left_edge_word_cut False


### G1 结论

| 判据 | 要求 | A | B | 结果 |
|---|---|---|---|---|
| 有词的识别句占比 `utterances_with_words / utterances` | >= 0.9 | 6/6 = 1.0 | 3/3 = 1.0 | 满足 |
| 词落在所属识别句 ±300 ms 内 `words_inside_their_utterance / words` | >= 0.98 | 113/225 = 0.50 | 62/118 = 0.53 | **不满足** |
| 词起点单调 `words_monotonic` | True | False | False | **不满足** |
| 时间颗粒 `time_grid_ms` | <= 40 | 1 | 1 | 1 ms 步长(满足,精细) |
| 词元对上的比例 `token_word_match` | >= 0.85 | 1.0 | 0.966 | 满足 |
| 跨次抖动 `jitter_p95`(ms) | <= 150 | 80(样本仅 7 个词) | 无样本(接缝窗口内 0 个词) | A 满足,B 未测出 |
| 半段边缘的词被切 `left_edge_word_cut` | 记录 | False | False | 记录 |
| v1 句边界离词的距离 `v1_edge_p95` / `v1_edges_over_300` | 记录 | 491 / 1 | 280 / 0 | 记录 |
| `additions` 键名 | 记录 | fixed_prefix_result, source, speaker_id | 同 A | 记录 |
| **G1** | | | | **C** |

判定:**C**。词起点在两段素材里都不单调,且只有约一半的词落在所属识别句内。B2 的前提(只有「词在识别句内」不满足、且每个词终点不超过识别句长度)也不成立:`gap_p90` 约 53–58 s、识别句内最大词间隔最大值 59.7 s,说明词时间里混有不在识别句时间范围内的值。

观察(数字推断,**未验证**,未再花钱确认):约一半的词长度为 0(`dur_zero` 112/225、56/118),与「在识别句内」的词数几乎一一对应;词时间的形状疑似不是「每个词一组 start/end 且与识别句同一基准」,可能混入了另一种时间(例如相对时间或占位值)。要弄清必须看原始词时间序列(字段值,不含文字),这需要再运行一次探针并打印数字,**未获授权,未做**。

按计划 G1:停,把结果交给用户,问是否仍要做 T6–T10(保留识别结果、重新分句、评估,不含词路径);不自作主张继续 T1–T5(词路径)。
