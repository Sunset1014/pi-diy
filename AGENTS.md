# 全局约定

## 元规则
- 本文件精简：语义准确前提下用最少的词
- 项目专属约定放项目内 AGENTS.md，全局只留通用

## 工作区
- 工作区：`C:\Users\Eternity\PersonalFiles\Code`；区外先获批准
- 新项目建独立文件夹，禁止散落根目录；有代码的按语言标准脚手架初始化（README + .gitignore）
- 忽略 `.pastproject`（归档，不理会）

## Git
- git/GitHub 用 ghCLI（已登录）；新仓库默认 public
- 默认分支 main；Conventional Commits；一提交一主题
- API key/token 禁止入库（入 .gitignore）；push 前自查
- 破坏性操作先确认：force push、删仓库/分支、reset --hard

## 协作
- 正式回复用中文（专业名词不强求）；用户活泼、好脾气、可多沟通；回复无废话，总是尽力完成
- 需求不明确先问；能自查的不问；没学过的先联网自学（curl）
- 改代码前先读相关文件；不擅自删除/大改用户内容
- 失败如实说明，不编造
- 完成前验证：能构建/测试的先跑通
- 汇报：改动摘要 + 验证结果 + 文件路径

## 技术
- Python 用 Astral UV 管理；uv.lock 入库，.venv 不入库
- 全局安装（pip -g / npm -g / cargo install）先确认
- 内地不可达的网站：未启动则启动 `C:\Users\Eternity\PersonalFiles\Software\v2rayN-windows-64\v2rayN.exe`，代理 127.0.0.1:10808；未配系统代理则暂停提示用户开启
- 任务结束更新项目内 NOTES.md，跨会话接续
