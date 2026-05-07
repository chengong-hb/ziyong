# Cloudflare 云端部署说明

这个项目可以部署到 Cloudflare Pages。部署后，电脑关机、`ST.bat` 不打开，外网网址也能访问。

## 一次性准备

1. 注册并登录 Cloudflare 账号。
2. 把 `hbst.com` 添加到 Cloudflare。
3. 如果 Cloudflare 提示要更换域名 NS，就去域名注册商后台把 NS 改成 Cloudflare 给你的两个 NS。
4. 等 Cloudflare 显示 `hbst.com` 已生效。

## 登录 Wrangler

在项目目录 `D:\LLQ\codex\1` 运行：

```powershell
npx.cmd wrangler login
```

浏览器会打开 Cloudflare 登录页。登录成功后回到终端。

## 部署 Pages

运行：

```powershell
.\Deploy-Cloudflare.ps1
```

项目名默认是 `st-image2`。部署成功后，Cloudflare 会给一个 `*.pages.dev` 临时网址。

## 绑定固定域名

在 Cloudflare Pages 项目里绑定自定义域名：

```text
st.hbst.com
```

绑定完成后，固定外网网址就是：

```text
https://st.hbst.com
```

## 日常使用

- 外网网址：`https://st.hbst.com`
- 自用网址：`https://st.hbst.com`
- 本地调试网址：`http://127.0.0.1:3000`

云端部署后，外网网址不依赖你的电脑，也不依赖 `ST.bat`。

`ST.bat` 只用于本机临时调试和旧的临时分享方式。
