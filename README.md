# 飞乐

类似 `Alist`，但专注影视剧观看、更新。

## 功能

1. 索引云盘文件并通过海报墙展示云盘内影视文件
2. 在线观看云盘视频、记录观看历史
3. 家庭成员可直接通过授权链接访问，无需登录
4. 自动追踪影视剧更新并同步至云盘

## 使用前须知

该项目**「不提供影视剧资源」**，它的核心功能是根据云盘内的影视剧文件名字在 `TMDB` 上搜索对应影视剧的海报、描述等信息。使用该项目前，你必须有

1. 存储了影视剧文件的云盘（目前仅支持阿里云盘）
2. 能够抓包查看网络请求、安装了阿里云盘的手机
3. 下面两个二选一
   3.1 要求外网可以访问，需要一台可以公网访问的服务器（性能要求低，视频播放直接走阿里云盘不占服务器流量）
   3.2 只在局域网内使用，一台电脑即可

## 运行

`clone` 项目后安装依赖，执行 `node scripts/ncc.js`。然后 `yarn dev` 就可以了。


## 效果预览

### 移动端，用于播放视频

### 后台管理，用于管理云盘和影视剧

## API 文档

管理后台 API
https://documenter.getpostman.com/view/7312751/2s93sXdEzv

视频观看 API
https://documenter.getpostman.com/view/7312751/2s93sXdF5R
