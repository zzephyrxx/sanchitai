# 三尺台 v0.2.3 · Windows 安装包编译构建指南

本文档用于指导在 **Windows 10 / 11 (x64)** 环境下，将三尺台源码打包构建为 Windows 安装程序（NSIS `.exe`）。

---

## 一、环境准备（仅首次需要）

请按顺序安装以下 4 项基础环境：

1. **Node.js（推荐 v20.19+ 或 v22 LTS）**
   - 下载地址：<https://nodejs.org/>
   - 安装后在 PowerShell / CMD 中验证：`node -v`

2. **pnpm（v10.5+）**
   - 启用 Corepack 或直接全局安装：
     ```powershell
     npm install -g pnpm
     pnpm -v
     ```

3. **Microsoft C++ Build Tools（Visual Studio 生成工具）**
   - 下载地址：<https://visualstudio.microsoft.com/visual-cpp-build-tools/>
   - 安装时务必勾选工作负载：**「使用 C++ 的桌面开发 (Desktop development with C++)」**（默认包含 MSVC 编译器与 Windows 10/11 SDK）。

4. **Rust 工具链（rustc / cargo）**
   - 下载并运行 `rustup-init.exe`：<https://rustup.rs/>
   - 安装完成后**重新打开终端**，验证：`rustc -V` 与 `cargo -V`。

> **提示（WebView2）**：Windows 11 与新版 Windows 10 已内置 Microsoft Edge WebView2 运行时；若系统极旧，可从微软官网下载安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。

---

## 二、解压源码与安装依赖

1. 将压缩包 `sanchitai-v0.2.3-src.zip` 解压到**纯英文、无空格的短路径**（避免 Windows 路径过长或中文路径导致 NSIS/Cargo 报错），例如：
   ```text
   D:\sanchitai
   ```

2. 在解压目录打开 **PowerShell**（或终端），安装前端依赖：
   ```powershell
   cd D:\sanchitai
   pnpm install
   ```
   > 如国内下载较慢，可先设置镜像：`pnpm config set registry https://registry.npmmirror.com`

---

## 三、执行打包构建（生成 Windows 安装包）

运行以下命令，Tauri 会自动先执行 `pnpm build` 编译前端，再调用 Rust/NSIS 打包 Windows 安装程序：

```powershell
pnpm tauri build --bundles nsis
```

- **首次构建**：Rust 会下载并编译 Cargo 依赖，通常耗时约 3–8 分钟；后续二次构建仅需 30–60 秒。
- **仅检查前端是否能正常编译**（可选）：
  ```powershell
  pnpm typecheck
  pnpm build
  ```

---

## 四、获取安装包产物

构建成功后，在以下路径即可找到 Windows 安装包：

```text
src-tauri\target\release\bundle\nsis\三尺台_0.2.3_x64-setup.exe
```

同时，绿色单文件可执行程序位于：

```text
src-tauri\target\release\sanchitai.exe
```

---

## 五、常见问题排查

| 现象 | 解决方案 |
| --- | --- |
| `cargo` 下载 crates.io 极慢或超时 | 在 `C:\Users\<你的用户名>\.cargo\config.toml` 中配置清华/字节 crates 镜像源 |
| 报错 `link.exe not found` | 未安装 Visual Studio C++ Build Tools，请勾选「使用 C++ 的桌面开发」并重启终端 |
| 首次打包 NSIS 下载工具失败 | Tauri 首次打包会自动下载 NSIS 工具链，请保持网络通畅或开启代理后重新运行 `pnpm tauri build --bundles nsis` |
| `pnpm install` 提示版本不匹配 | 运行 `corepack enable` 或 `npm install -g pnpm@latest` 升级 pnpm |
