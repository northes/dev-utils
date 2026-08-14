# Welcome to Your New Wails3 Project!

Congratulations on generating your Wails3 application! This README will guide you through the next steps to get your project up and running.

## Getting Started

1. Navigate to your project directory in the terminal.

2. To run your application in development mode, use the following command:

   ```
   wails3 dev
   ```

   This will start your application and enable hot-reloading for both frontend and backend changes.

3. To build your application for production, use:

   ```
   wails3 build
   ```

   This will create a production-ready executable in the `build` directory.

## Exploring Wails3 Features

Now that you have your project set up, it's time to explore the features that Wails3 offers:

1. **Check out the examples**: The best way to learn is by example. Visit the `examples` directory in the `v3/examples` directory to see various sample applications.

2. **Run an example**: To run any of the examples, navigate to the example's directory and use:

   ```
   go run .
   ```

   Note: Some examples may be under development during the alpha phase.

3. **Explore the documentation**: Visit the [Wails3 documentation](https://v3.wails.io/) for in-depth guides and API references.

4. **Join the community**: Have questions or want to share your progress? Join the [Wails Discord](https://discord.gg/JDdSxwjhGf) or visit the [Wails discussions on GitHub](https://github.com/wailsapp/wails/discussions).

## Project Structure

Take a moment to familiarize yourself with your project structure:

- `frontend/`: Contains your frontend code (HTML, CSS, JavaScript/TypeScript)
- `main.go`: The entry point of your Go backend
- `app.go`: Define your application structure and methods here
- `wails.json`: Configuration file for your Wails project

## Next Steps

1. Modify the frontend in the `frontend/` directory to create your desired UI.
2. Add backend functionality in `main.go`.
3. Use `wails3 dev` to see your changes in real-time.
4. When ready, build your application with `wails3 build`.

Happy coding with Wails3! If you encounter any issues or have questions, don't hesitate to consult the documentation or reach out to the Wails community.

## 发布 macOS 版本

推送语义化版本标签即可触发 `.github/workflows/release-macos.yml`：

```bash
git tag v0.2.0
git push github v0.2.0
```

工作流会分别构建 Apple Silicon 与 Intel 包，并在同一个 GitHub Release 中上传：

- `DevUtils-<version>-darwin-<arch>.dmg`：用于首次安装；
- `DevUtils-<version>-darwin-<arch>.zip`：用于 Wails 应用内更新；
- `SHA256SUMS`：供应用下载后校验文件完整性。

仓库未配置 Apple 凭据时会生成 ad-hoc 签名包，仅适合测试。正式分发前请在 GitHub Actions Secrets 中配置：

- `APPLE_CERTIFICATE`：Developer ID Application 的 P12 Base64；
- `APPLE_CERTIFICATE_PASSWORD`：P12 密码；
- `APPLE_SIGNING_IDENTITY`：Developer ID Application 证书名称；
- `APPLE_ID`、`APPLE_APP_PASSWORD`、`APPLE_TEAM_ID`：Apple 公证凭据。

也可以从 Actions 页面手动运行工作流并输入 `v0.2.0` 形式的标签。应用内更新固定读取公开仓库 `northes/dev-utils` 的最新 GitHub Release。
