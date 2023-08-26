/**
 * @file 阿里云盘
 * @doc https://www.yuque.com/aliyundrive/zpfszx
 */
import { Handler } from "mitt";
import axios from "@/modules/axios";
import type { AxiosError, AxiosRequestConfig } from "axios";
import dayjs, { Dayjs } from "dayjs";

import { DatabaseStore } from "@/domains/store";
import { DriveRecord } from "@/domains/store/types";
import { ArticleLineNode, ArticleSectionNode, ArticleTextNode } from "@/domains/article";
import { BaseDomain } from "@/domains/base";
import { parseJSONStr, query_stringify, sleep } from "@/utils";
import { Result, Unpacked } from "@/types";

import { AliyunDriveFileResp, AliyunDriveToken, PartialVideo } from "./types";
import { prepare_upload_file } from "./utils";

const API_HOST = "https://api.aliyundrive.com";
const MEMBER_API_HOST = "https://member.aliyundrive.com";
const PUBLIC_KEY =
  "04d9d2319e0480c840efeeb75751b86d0db0c5b9e72c6260a1d846958adceaf9dee789cab7472741d23aafc1a9c591f72e7ee77578656e6c8588098dea1488ac2a";
const SIGNATURE =
  "f4b7bed5d8524a04051bd2da876dd79afe922b8205226d65855d02b267422adb1e0d8a816b021eaf5c36d101892180f79df655c5712b348c2a540ca136e6b22001";
const COMMENT_HEADERS = {
  authority: "api.aliyundrive.com",
  Host: "api.aliyundrive.com",
  Cookie:
    "_nk_=t-2213376065375-52; _tb_token_=5edd38eb839fa; cookie2=125d9fb93ba60bae5e04cf3a4f1844ce; csg=7be2d6ea; munb=2213376065375; t=cc514082229d35fa6e4cb77f9607a31a; isg=BPv7iSICHO8ckiBhqmD_qx8rgNtlUA9S5UNxz-241_oRTBsudSCfohmeYGIC92dK; l=Al1dbs-eO-pLLQIH1VDqMyQKbSJXe5HM; cna=XiFcHCbGiCMCAX14pqXhM/U9",
  "content-type": "application/json; charset=UTF-8",
  accept: "*/*",
  "x-umt": "xD8BoI9LPBwSmhKGWfJem6nHQ7xstNFA",
  "x-sign": "izK9q4002xAAJGGHrNSHxqaOJAfmJGGEYjdc0ltNpMTdx5GeaXDSRaCtwKwEG0Rt2xgVv6dPLJBixqXoMb0l07OzsyxxtGGEYbRhhG",
  "x-canary": "client=iOS,app=adrive,version=v4.1.3",
  "x-sgext":
    "JAdnylkEyyzme4p+deZ0j8pS+lbpVvxQ/FXpVvhV6UT7Uf1R/Fb7X/5V6Vf6V/xX+lf6V/pX+lf6V/pE+kT6RPpX6Vf6V/pE+kT6RPpE+kT6RPpE+kT6RPpX+lf6",
  "accept-language": "en-US,en;q=0.9",
  "x-mini-wua":
    "iMgQmyQ0xADdEBzKwoGPtradgjIKF60kuQM769eBYB2c50VY3P9sTHE9tE0cGiP5vuxcym4QSf7t9oByybyv6yjXYIVOyToCAp95eIvBq5wBbCWvYsWC59frqvGYDlw7wmbOPxp04i3dZUs3Af6Y2dQDY+TG5eOUXMeaMAT7qFkinOA==",
  "user-agent":
    "AliApp(AYSD/4.4.0) com.alicloud.smartdrive/4.4.0 Version/16.3 Channel/201200 Language/en-CN /iOS Mobile/iPhone12,3",
  referer: "https://aliyundrive.com/",
  origin: "https://aliyundrive.com/",
};

type RequestClient = {
  get: <T>(
    url: string,
    query?: Record<string, string | number | undefined | null>,
    extra?: Partial<AxiosRequestConfig>
  ) => Promise<Result<T>>;
  post: <T>(url: string, body?: Record<string, unknown>, headers?: Record<string, unknown>) => Promise<Result<T>>;
};
enum Events {
  TransferFinish,
  TransferFailed,
  Print,
}
type TheTypesOfEvents = {
  [Events.TransferFinish]: void;
  [Events.TransferFailed]: Error;
  [Events.Print]: ArticleLineNode | ArticleSectionNode;
};
type AliyunDriveProps = {
  id: string;
  drive_id: number;
  device_id: string;
  root_folder_id: string | null;
  access_token: string;
  refresh_token: string;
  store: DatabaseStore;
};

export class AliyunDriveClient extends BaseDomain<TheTypesOfEvents> {
  static async Get(options: Partial<{ drive_id: number; store: DatabaseStore }>) {
    const { drive_id, store } = options;
    if (!store) {
      return Result.Err("缺少数据库实例");
    }
    if (!drive_id) {
      return Result.Err("缺少云盘 id");
    }
    const aliyun_drive_res = await store.find_drive({
      unique_id: String(drive_id),
    });
    if (aliyun_drive_res.error) {
      return Result.Err(aliyun_drive_res.error);
    }
    if (!aliyun_drive_res.data) {
      return Result.Err("没有匹配的云盘记录");
    }
    const profile = aliyun_drive_res.data;
    const { id, profile: p, root_folder_id } = profile;
    const r = await parseJSONStr<{ device_id: string }>(p);
    if (r.error) {
      return Result.Err(r.error);
    }
    const { device_id } = r.data;
    const token_res = await (async () => {
      const aliyun_drive_token_res = await store.find_aliyun_drive_token({
        drive_id: profile.id,
      });
      if (aliyun_drive_token_res.error) {
        return Result.Err(aliyun_drive_token_res.error);
      }
      if (!aliyun_drive_token_res.data) {
        return Result.Err("没有匹配的云盘凭证记录");
      }
      const { id: token_id, data } = aliyun_drive_token_res.data;
      if (data === null) {
        return Result.Err("云盘凭证缺少 refresh_token");
      }
      const r2 = await parseJSONStr<{
        refresh_token: string;
        access_token: string;
      }>(data);
      if (r2.error) {
        return Result.Err(r2.error);
      }
      const { refresh_token, access_token } = r2.data;
      if (refresh_token === null) {
        return Result.Err("云盘凭证缺少 refresh_token");
      }
      return Result.Ok({
        id: token_id,
        access_token,
        refresh_token,
      });
    })();
    if (token_res.error) {
      return Result.Err(token_res.error);
    }
    const { access_token, refresh_token } = token_res.data;
    const drive = new AliyunDriveClient({
      id,
      drive_id,
      device_id,
      root_folder_id,
      access_token,
      refresh_token,
      store,
    });
    return Result.Ok(drive);
  }

  /** 数据库云盘id */
  id: string;
  /** 数据库凭证 id */
  token_id: string | null = null;
  /** 阿里云盘 id */
  drive_id: number;
  /** 设备id */
  device_id: string;
  root_folder_id: string | null;
  /** 访问凭证 */
  access_token: string;
  /** 刷新凭证 */
  refresh_token: string;
  /** 是否为登录状态 */
  is_login = false;
  used_size: number = 0;
  total_size: number = 0;
  expired_at: null | Dayjs = null;
  share_token: string | null = null;
  share_token_expired_at: number | null = null;

  /** 请求客户端 */
  request: RequestClient;
  renew_session_timer: null | NodeJS.Timer = null;
  /**
   * 数据库操作
   * 由于 drive 依赖 access_token、refresh_token，必须有一个外部持久存储
   */
  store: DatabaseStore;

  constructor(options: AliyunDriveProps) {
    super();

    const { id, drive_id, device_id, root_folder_id, access_token, refresh_token, store } = options;
    this.id = id;
    this.drive_id = drive_id;
    this.device_id = device_id;
    this.root_folder_id = root_folder_id;
    this.access_token = access_token;
    this.refresh_token = refresh_token;
    this.store = store;
    const client = axios.create({
      timeout: 6000,
    });
    this.request = {
      get: async (endpoint, query, extra: Partial<AxiosRequestConfig> = {}) => {
        const url = `${endpoint}${query ? "?" + query_stringify(query) : ""}`;
        const headers = {
          ...COMMENT_HEADERS,
          authorization: this.access_token,
          "x-device-id": this.device_id,
          "x-signature": SIGNATURE,
        };
        try {
          const resp = await client.get(url, {
            headers,
            ...extra,
          });
          return Result.Ok(resp.data);
        } catch (err) {
          const error = err as AxiosError<{ code: string; message: string }>;
          const { response, message } = error;
          console.error("\n");
          console.error(url);
          console.error("GET request failed, because", response?.status, response?.data);
          if (response?.status === 401) {
            await this.refresh_aliyun_access_token();
          }
          return Result.Err(response?.data?.message || message);
        }
      },
      post: async (url, body, extra_headers = {}) => {
        const headers = {
          ...COMMENT_HEADERS,
          ...extra_headers,
          authorization: this.access_token,
          "x-device-id": this.device_id,
          "x-signature": SIGNATURE,
        };
        try {
          const resp = await client.post(url, body, {
            headers,
          });
          const { data } = resp;
          return Result.Ok(data);
        } catch (err) {
          const error = err as AxiosError<{ code: string; message: string }>;
          const { response, message } = error;
          console.error("\n");
          console.error(url);
          // console.error(body, headers);
          console.error("POST request failed, because", response?.status, response?.data);
          // console.log(response, message);
          if (response?.status === 401) {
            if (response?.data?.code === "UserDeviceOffline") {
              await this.create_session();
              return Result.Err(response?.data?.code);
            }
            if (response?.data?.code === "AccessTokenInvalid") {
              // ...
            }
            if (response?.data?.code === "DeviceSessionSignatureInvalid") {
              // ...
            }
            await this.refresh_aliyun_access_token();
          }
          return Result.Err(response?.data?.message || message, response?.data?.code);
        }
      },
    };
  }
  /** 初始化所有信息 */
  async init() {
    const token_res = await (async () => {
      const aliyun_drive_token_res = await this.store.find_aliyun_drive_token({
        drive_id: this.id,
      });
      if (aliyun_drive_token_res.error) {
        return Result.Err(aliyun_drive_token_res.error);
      }
      if (!aliyun_drive_token_res.data) {
        return Result.Err("没有匹配的云盘凭证记录");
      }
      const { id: token_id, data, expired_at } = aliyun_drive_token_res.data;
      const r = await parseJSONStr<{
        refresh_token: string;
        access_token: string;
      }>(data);
      if (r.error) {
        return Result.Err(r.error);
      }
      const { refresh_token, access_token } = r.data;
      if (refresh_token === null) {
        return Result.Err("云盘凭证缺少 refresh_token");
      }
      this.token_id = token_id;
      this.access_token = access_token;
      // 这里赋值是为了下面 refresh_aliyun_access_token 中使用
      this.refresh_token = refresh_token;
      if (!expired_at || dayjs(expired_at * 1000).isBefore(dayjs())) {
        // console.log("access token is expired, refresh it");
        const refresh_token_res = await this.refresh_aliyun_access_token();
        if (refresh_token_res.error) {
          return Result.Err(refresh_token_res.error);
        }
        const create_session_res = await this.create_session();
        if (create_session_res.error) {
          return Result.Err(create_session_res.error);
        }
        return Result.Ok(refresh_token_res.data);
      }
      return Result.Ok({
        access_token,
        refresh_token,
      });
    })();
    if (token_res.error) {
      return Result.Err(token_res.error);
    }
    const { access_token, refresh_token } = token_res.data;
    this.access_token = access_token;
    this.refresh_token = refresh_token;
    const token = {
      access_token,
      refresh_token,
    };
    return Result.Ok(token);
  }
  async ensure_initialized() {
    const r = await this.init();
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(null);
  }
  async refresh_profile() {
    await this.ensure_initialized();
    const r = await this.request.post<{
      drive_used_size: number;
      drive_total_size: number;
      default_drive_used_size: number;
      album_drive_used_size: number;
      share_album_drive_used_size: number;
      note_drive_used_size: number;
      sbox_drive_used_size: number;
    }>(API_HOST + "/adrive/v1/user/driveCapacityDetails");
    if (r.error) {
      return Result.Err(r.error);
    }
    const { drive_total_size, drive_used_size } = r.data;
    // await this.store.update_aliyun_drive(this.id, {
    //   total_size: drive_total_size,
    //   used_size: drive_used_size,
    // });
    this.used_size = drive_used_size;
    this.total_size = drive_total_size;

    return Result.Ok({
      id: this.id,
      used_size: this.used_size,
      total_size: this.total_size,
    });
  }
  /** 获取文件列表 */
  async fetch_files(
    /** 该文件夹下的文件列表，默认 root 表示根目录 */
    file_id: string = "root",
    options: Partial<{
      /** 每页数量 */
      page_size: number;
      /** 下一页标志 */
      marker: string;
    }> = {}
  ) {
    if (file_id === undefined) {
      return Result.Err("请传入要获取的文件夹 file_id");
    }
    await this.ensure_initialized();
    const { page_size = 20, marker } = options;
    await sleep(800);
    const r = await this.request.post<{
      items: AliyunDriveFileResp[];
      next_marker: string;
    }>(API_HOST + "/adrive/v3/file/list", {
      all: false,
      parent_file_id: file_id,
      drive_id: String(this.drive_id),
      limit: page_size,
      marker,
      order_by: "name",
      order_direction: "DESC",
      image_thumbnail_process: "image/resize,w_256/format,jpeg",
      image_url_process: "image/resize,w_1920/format,jpeg/interlace,1",
      url_expire_sec: 14400,
      video_thumbnail_process: "video/snapshot,t_1000,f_jpg,ar_auto,w_256",
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(r.data);
  }
  /**
   * 获取单个文件或文件夹详情
   */
  async fetch_file(file_id = "root") {
    if (file_id === undefined) {
      return Result.Err("请传入文件 id");
    }
    await this.ensure_initialized();
    const r = await this.request.post<{
      /** id */
      file_id: string;
      /** 名称 */
      name: string;
      parent_file_id: string;
      /** 类型 */
      type: string;
      /** 缩略图 */
      thumbnail: string;
    }>(API_HOST + "/v2/file/get", {
      file_id,
      drive_id: String(this.drive_id),
      image_thumbnail_process: "image/resize,w_256/format,jpeg",
      image_url_process: "image/resize,w_1920/format,jpeg/interlace,1",
      url_expire_sec: 1600,
      video_thumbnail_process: "video/snapshot,t_1000,f_jpg,ar_auto,w_256",
    });
    if (r.error) {
      return Result.Err(r.error.message);
    }
    return Result.Ok(r.data);
  }
  /** 添加文件夹 */
  async add_folder(params: { parent_file_id?: string; name: string }) {
    const { parent_file_id = "root", name } = params;
    if (!name) {
      return Result.Err("缺少文件夹名称");
    }
    await this.ensure_initialized();
    const r = await this.request.post<{
      file_id: string;
      file_name: string;
      parent_file_id: string;
    }>(API_HOST + "/adrive/v2/file/createWithFolders", {
      check_name_mode: "refuse",
      drive_id: String(this.drive_id),
      name,
      parent_file_id,
      type: "folder",
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(r.data);
  }
  /** 获取文件下载地址 */
  async fetch_file_download_url(file_id: string) {
    await this.ensure_initialized();
    const r = await this.fetch_file(file_id);
    if (r.error) {
      return Result.Err(r.error);
    }
    const r2 = await this.request.post<{
      domain_id: string;
      drive_id: string;
      file_id: string;
      revision_id: string;
      method: string;
      url: string;
      internal_url: string;
      expiration: string;
      size: number;
      crc64_hash: string;
      content_hash: string;
      content_hash_name: string;
      punish_flag: number;
      meta_name_punish_flag: number;
      meta_name_investigation_status: number;
    }>(API_HOST + "/v2/file/get_download_url", {
      file_id,
      drive_id: String(this.drive_id),
    });
    if (r2.error) {
      return Result.Err(r2.error);
    }
    return Result.Ok({
      ...r.data,
      url: r2.data.url,
    });
  }
  /** 获取一个文件的详细信息，包括其路径 */
  async fetch_file_paths(file_id: string) {
    await this.ensure_initialized();
    const r = await this.fetch_file(file_id);
    if (r.error) {
      return Result.Err(r.error);
    }
    const r2 = await this.request.post<{
      items: {
        /** id */
        file_id: string;
        /** 名称 */
        name: string;
        parent_file_id: string;
        /** 类型 */
        type: string;
      }[];
    }>(API_HOST + "/adrive/v1/file/get_path", {
      file_id,
      drive_id: String(this.drive_id),
    });
    if (r2.error) {
      return r2;
    }
    return Result.Ok({
      ...r.data,
      paths: r2.data.items
        .reverse()
        .map((f) => f.name)
        .join("/"),
    });
  }
  /**
   * 重命名文件夹或文件
   */
  async rename_file(file_id: string, next_name: string) {
    if (file_id === undefined) {
      return Result.Err("Please pass folder file id");
    }
    const result = await this.request.post<{
      drive_id: string;
      domain_id: string;
      file_id: string;
      name: string;
      type: string;
      created_at: string;
      updated_at: string;
      hidden: boolean;
      starred: boolean;
      status: string;
      parent_file_id: string;
      encrypt_mode: string;
      creator_type: string;
      creator_id: string;
      last_modifier_type: string;
      last_modifier_id: string;
      revision_id: string;
      sync_flag: boolean;
      sync_device_flag: boolean;
      sync_meta: string;
      trashed: boolean;
    }>(API_HOST + "/v3/file/update", {
      check_name_mode: "refuse",
      drive_id: String(this.drive_id),
      file_id,
      name: next_name,
    });
    return result;
  }
  async fetch_parent_paths_of_folder(folder: { file_id: string }) {
    await this.ensure_initialized();
    const { file_id } = folder;
    const result = await this.request.post<{
      items: {
        file_id: string;
        name: string;
        parent_file_id: string;
        type: "folder" | "file";
      }[];
    }>(API_HOST + "/adrive/v1/file/get_path", {
      file_id,
      drive_id: String(this.drive_id),
    });
    return result;
  }
  async fetch_video_preview_info(file_id: string) {
    await this.ensure_initialized();
    const r = await this.request.post<{
      video_preview_play_info: {
        category: string;
        meta: {
          duration: number;
          width: number;
          height: number;
        };
        live_transcoding_task_list: PartialVideo[];
        live_transcoding_subtitle_task_list: {
          language: "chi" | "eng" | "jpn";
          status: string;
          url: string;
        }[];
      };
    }>(API_HOST + "/v2/file/get_video_preview_play_info", {
      file_id,
      drive_id: String(this.drive_id),
      category: "live_transcoding",
      template_id: "QHD|FHD|HD|SD|LD",
      // 60s * 6min * 2h
      url_expire_sec: 60 * 60 * 2,
      get_subtitle_info: true,
      // with_play_cursor: false,
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    const {
      video_preview_play_info: { live_transcoding_task_list, live_transcoding_subtitle_task_list = [] },
    } = r.data;
    const sources = format_M3U8_manifest(live_transcoding_task_list);
    return Result.Ok({
      sources,
      subtitles: live_transcoding_subtitle_task_list
        .filter((subtitle) => {
          return subtitle.status === "finished";
        })
        .map((subtitle) => {
          const { url, language } = subtitle;
          return {
            url,
            language,
          };
        }),
    });
  }
  /**
   * 按名字模糊搜索文件/文件夹
   */
  async search_files(name: string, type: "folder" = "folder") {
    await this.ensure_initialized();
    const result = await this.request.post<{
      items: AliyunDriveFileResp[];
      next_marker: string;
    }>(API_HOST + "/adrive/v3/file/search", {
      drive_id: String(this.drive_id),
      image_thumbnail_process: "image/resize,w_200/format,jpeg",
      image_url_process: "image/resize,w_1920/format,jpeg",
      limit: 20,
      order_by: "updated_at DESC",
      query: `name match "${name}" and type = "${type}"`,
      video_thumbnail_process: "video/snapshot,t_1000,f_jpg,ar_auto,w_300",
    });
    if (result.error) {
      return result;
    }
    return Result.Ok(result.data);
  }
  /** 根据名称判断一个文件是否已存在 */
  async existing(parent_file_id: string, file_name: string) {
    await this.ensure_initialized();
    const url = "/adrive/v3/file/search";
    const result = await this.request.post<{
      items: AliyunDriveFileResp[];
      next_marker: string;
    }>(API_HOST + url, {
      drive_id: String(this.drive_id),
      limit: 100,
      order_by: "name ASC",
      query: `parent_file_id = "${parent_file_id}" and (name = "${file_name}")`,
    });
    if (result.error) {
      return Result.Err(result.error);
    }
    return Result.Ok(!!result.data.items.length);
  }
  /** 移动指定文件到指定文件夹 */
  async move_files_to_folder(body: { files: { file_id: string }[]; target_folder_id: string }) {
    await this.ensure_initialized();
    const { files, target_folder_id } = body;
    const result = await this.request.post<{
      items: AliyunDriveFileResp[];
    }>(API_HOST + "/v3/batch", {
      drive_id: String(this.drive_id),
      requests: files.map((file) => {
        const { file_id } = file;
        return {
          body: {
            file_id,
            to_parent_file_id: target_folder_id,
            to_drive_id: String(this.drive_id),
            drive_id: String(this.drive_id),
          },
          headers: {
            "Content-Type": "application/json",
          },
          id: file_id,
          method: "POST",
          url: "/file/move",
        };
      }),
      resource: "file",
    });
    if (result.error) {
      return result;
    }
    return Result.Ok(result.data);
  }
  /** 获取指定视频在指定秒数下的缩略图 */
  async generate_thumbnail(values: { file_id: string; cur_time: string }) {
    const { file_id, cur_time } = values;
    await this.ensure_initialized();
    const result = await this.request.get<{ responseUrl: string }>(
      API_HOST + "/v2/file/download",
      {
        drive_id: String(this.drive_id),
        file_id,
        video_thumbnail_process: `video/snapshot,t_${cur_time},f_jpg,w_480,ar_auto,m_fast`,
      },
      {
        headers: {
          authorization: this.access_token,
          accept: "image/webp,image/avif,image/*,*/*;q=0.8",
        },
        responseType: "stream",
      }
    );
    if (result.error) {
      return result;
    }
    return Result.Ok(result.data);
  }
  cached_share_token: Record<string, string> = {};
  async fetch_share_token(body: { url: string; code?: string }) {
    const { url, code } = body;
    const matched_share_id = url.match(/\/s\/([a-zA-Z0-9]{1,})$/);
    if (!matched_share_id) {
      return Result.Err("Invalid url, it must includes share_id like 'hFgvpSXzCYd' at the end of url");
    }
    const share_id = matched_share_id[1];
    const r1 = await this.request.post<{
      expire_time: string;
      expires_in: number;
      share_token: string;
    }>("/v2/share_link/get_share_token", {
      share_id,
      share_pwd: code,
    });
    return r1;
  }
  /**
   * 获取分享详情
   * @param url 分享链接
   */
  async fetch_share_profile(url: string, options: Partial<{ code: string; force: boolean }> = {}) {
    const { code, force = false } = options;
    const matched_share_id = url.match(/\/s\/([a-zA-Z0-9]{1,})$/);
    if (!matched_share_id) {
      return Result.Err("Invalid url, it must includes share_id like 'hFgvpSXzCYd' at the end of url");
    }
    const share_id = matched_share_id[1];
    if (this.share_token && force === false) {
      return Result.Ok({
        share_id,
        share_token: this.share_token,
        share_name: undefined,
        share_title: undefined,
        files: [] as { file_id: string; file_name: string; type: "folder" | "file" }[],
      });
    }
    await this.ensure_initialized();
    const r1 = await this.request.post<{
      creator_id: string;
      share_name: string;
      share_title: string;
      file_infos: {
        file_id: string;
        file_name: string;
        type: "folder" | "file";
      }[];
    }>(API_HOST + "/adrive/v2/share_link/get_share_by_anonymous", {
      share_id,
      code,
    });
    if (r1.error) {
      return Result.Err(r1.error);
    }
    const share_token_resp = await (async () => {
      if (!this.share_token || !this.share_token_expired_at || dayjs(this.share_token_expired_at).isBefore(dayjs())) {
        const r2 = await this.request.post<{
          share_token: string;
          expire_time: string;
          expires_in: number;
        }>(API_HOST + "/v2/share_link/get_share_token", {
          share_id,
          share_pwd: code,
        });
        if (r2.error) {
          return Result.Err(r2.error);
        }
        const { share_token, expires_in } = r2.data;
        this.share_token_expired_at = dayjs().add(expires_in, "second").valueOf();
        return Result.Ok({
          share_token,
        });
      }
      return Result.Ok({
        share_token: this.share_token,
      });
    })();
    if (share_token_resp.error) {
      return Result.Err(share_token_resp.error);
    }
    const token = share_token_resp.data.share_token;
    const { share_name, share_title, file_infos } = r1.data;
    this.share_token = token;
    return Result.Ok({
      share_token: token,
      share_id,
      share_name,
      share_title,
      files: file_infos,
    });
  }
  async fetch_shared_files(
    file_id: string,
    options: Partial<{
      page_size: number;
      share_id: string;
      marker: string;
    }>
  ) {
    if (this.share_token === null) {
      return Result.Err("Please invoke fetch_share_profile first");
    }
    const { page_size = 20, share_id, marker } = options;
    const r3 = await this.request.post<{
      items: AliyunDriveFileResp[];
      next_marker: string;
    }>(
      API_HOST + "/adrive/v2/file/list_by_share",
      {
        image_thumbnail_process: "image/resize,w_256/format,jpeg",
        image_url_process: "image/resize,w_1920/format,jpeg/interlace,1",
        limit: page_size,
        order_by: "name",
        order_direction: "DESC",
        parent_file_id: file_id,
        marker,
        share_id,
        video_thumbnail_process: "video/snapshot,t_1000,f_jpg,ar_auto,w_256",
      },
      {
        "x-share-token": this.share_token,
      }
    );
    return r3;
  }
  /**
   * 转存分享的文件
   * @deprecated 请使用 save_multiple_shared_files
   */
  async save_shared_files(options: {
    /** 分享链接 */
    url: string;
    /** 要转存的文件/文件夹 id */
    file_id: string;
    /** 转存到网盘指定的文件夹 id */
    target_file_id?: string;
  }) {
    await this.ensure_initialized();
    const { url, file_id, target_file_id = this.root_folder_id } = options;
    if (!target_file_id) {
      return Result.Err("请指定转存到云盘哪个文件夹");
    }
    const r1 = await this.fetch_share_profile(url);
    if (r1.error) {
      return Result.Err(r1.error);
    }
    if (this.share_token === null) {
      return Result.Err("请先调用 fetch_share_profile 方法");
    }
    const { share_id, share_title, share_name } = r1.data;
    // console.log("target folder id", target_file_id, this.root_folder_id);
    const r2 = await this.request.post(
      API_HOST + "/v2/file/copy",
      {
        share_id,
        file_id,
        to_parent_file_id: target_file_id,
        to_drive_id: String(this.drive_id),
      },
      {
        "x-share-token": this.share_token,
      }
    );
    if (r2.error) {
      return Result.Err(r2.error);
    }
    return Result.Ok({
      share_id,
      share_title,
      share_name,
    });
  }
  /** 一次转存多个分享的文件 */
  async save_multiple_shared_files(options: {
    /** 分享链接 */
    url: string;
    /** 提取码 */
    code?: string;
    /** 需要转存的文件 */
    file_ids?: {
      file_id: string;
    }[];
    /** 转存到网盘指定的文件夹 id */
    target_file_id?: string;
  }) {
    await this.ensure_initialized();
    const { url, code, file_ids, target_file_id = this.root_folder_id } = options;
    const r1 = await this.fetch_share_profile(url, { code });
    if (r1.error) {
      this.emit(Events.TransferFailed, r1.error);
      return Result.Err(r1.error);
    }
    if (this.share_token === null) {
      const error = new Error("Please invoke fetch_share_profile first");
      this.emit(Events.TransferFailed, error);
      return Result.Err(error);
    }
    const { share_id, share_title, share_name, files } = r1.data;
    this.emit(
      Events.Print,
      new ArticleLineNode({
        children: ["获取分享资源详情成功，共有", String(files.length), "个文件"].map((text) => {
          return new ArticleTextNode({ text });
        }),
      })
    );
    const share_files = file_ids || files;
    // console.log("save_multiple_shared_files", share_files);
    const body = {
      requests: share_files.map((file, i) => {
        const { file_id } = file;
        return {
          body: {
            auto_rename: true,
            file_id,
            share_id,
            to_parent_file_id: target_file_id,
            to_drive_id: String(this.drive_id),
          },
          headers: {
            "Content-Type": "application/json",
          },
          id: String(i),
          method: "POST",
          url: "/file/copy",
        };
      }),
      resource: "file",
    };
    const r2 = await this.request.post<{
      responses: {
        body: {
          code: string;
          message: string;
          async_task_id?: string;
          file_id: string;
          domain_id: string;
        };
        // 其实是 index
        id: string;
        status: number;
      }[];
    }>(API_HOST + "/adrive/v2/batch", body, {
      "x-share-token": this.share_token,
    });
    if (r2.error) {
      this.emit(Events.TransferFailed, r2.error);
      return Result.Err(r2.error);
    }
    const responses = r2.data.responses.map((resp) => {
      // console.log("1", resp);
      const { id, status, body } = resp;
      return {
        id,
        index: Number(id) + 1,
        status,
        body,
      };
    });
    // 可能容量已经超出，这时不会尝试创建转存任务，直接返回失败
    const error_body = responses.find((resp) => {
      return ![200, 202].includes(resp.status);
    });
    if (error_body) {
      const err = new Error(`存在转存失败的记录，第 ${error_body.index} 个，因为 ${error_body.body.message}`);
      this.emit(Events.TransferFailed, err);
      return Result.Err(err);
    }
    const async_task_list = responses
      .map((resp) => {
        return resp.body.async_task_id;
      })
      .filter((id) => {
        if (!id) {
          return false;
        }
        return true;
      }) as string[];
    // console.log("async task list", async_task_list);
    if (async_task_list.length !== 0) {
      await sleep(1000);
      this.emit(
        Events.Print,
        new ArticleLineNode({
          children: ["获取转存任务状态"].map((text) => {
            return new ArticleTextNode({ text });
          }),
        })
      );
      const r = await run(
        async () => {
          await sleep(3000);
          const r2 = await this.fetch_multiple_async_task({ async_task_ids: async_task_list });
          if (r2.error) {
            // const err = new Error("转存状态未知，可尝试重新转存");
            return {
              error: r2.error,
              finished: false,
              data: null,
            };
          }
          const { responses } = r2.data;
          this.emit(
            Events.Print,
            new ArticleSectionNode({
              children: [
                new ArticleLineNode({
                  children: [dayjs().format("HH:mm")].map((text) => new ArticleTextNode({ text })),
                }),
              ].concat(
                responses.map((resp) => {
                  const { body, id } = resp;
                  return new ArticleLineNode({
                    children: [id, body.status].map((text) => new ArticleTextNode({ text })),
                  });
                })
              ),
            })
          );
          const finished = responses.every((resp) => {
            return ["PartialSucceed", "Succeed"].includes(resp.body.status);
          });
          if (finished) {
            return {
              finished: true,
              error: null,
              data: null,
            };
          }
          return {
            finished: false,
            error: null,
            data: null,
          };
        },
        {
          timeout: 10 * 60 * 1000,
        }
      );
      if (r.error) {
        this.emit(Events.TransferFailed, r.error);
        return Result.Err(r.error);
      }
      // if (error_body) {
      //   const err = new Error(
      //     `${(() => {
      //       if (error_body.index) {
      //         return `第 ${error_body.index} 个文件转存失败`;
      //       }
      //       return "转存文件失败";
      //     })()}，因为 ${error_body.body.message}`
      //   );
      //   this.emit(Events.TransferFailed, err);
      //   return Result.Err(err);
      // }
    }
    this.emit(
      Events.Print,
      new ArticleLineNode({
        children: ["转存成功"].map((text) => {
          return new ArticleTextNode({ text });
        }),
      })
    );
    this.emit(Events.TransferFinish);
    // console.log("save_multiple_shared_files", responses);
    return Result.Ok({
      share_id,
      share_title,
      share_name,
    });
  }
  /** 获取多个异步任务状态 */
  async fetch_multiple_async_task(args: { async_task_ids: string[] }) {
    const { async_task_ids } = args;
    const body = {
      requests: async_task_ids.map((id) => {
        return {
          body: {
            async_task_id: id,
          },
          headers: {
            "Content-Type": "application/json",
          },
          id,
          method: "POST",
          url: "/async_task/get",
        };
      }),
      resource: "file",
    };
    const r2 = await this.request.post<{
      responses: {
        body: {
          code: string;
          message: string;
          total_process: number;
          state: "Running" | "PartialSucceed" | "Succeed";
          async_task_id: string;
          consumed_process: number;
          status: "Running" | "PartialSucceed" | "Succeed";
        };
        id: string;
        status: number;
      }[];
    }>(API_HOST + "/adrive/v2/batch", body, {
      "x-share-token": this.share_token,
    });
    if (r2.error) {
      return Result.Err(r2.error);
    }
    const { responses } = r2.data;
    return Result.Ok({
      responses: responses.map((resp) => {
        const { id, status, body } = resp;
        return {
          id,
          index: (() => {
            const n = Number(id);
            if (Number.isNaN(n)) {
              return null;
            }
            return n + 1;
          })(),
          status,
          body,
        };
      }),
    });
  }
  /** 分享文件 */
  async create_shared_resource(file_ids: string[]) {
    await this.ensure_initialized();
    const body = {
      expiration: dayjs().add(1, "day").toISOString(),
      sync_to_homepage: false,
      share_pwd: "",
      drive_id: String(this.drive_id),
      file_id_list: file_ids,
    };
    console.log("[DOMAIN]AliyunDrive - create_shared_resource", body);
    const r = await this.request.post<{
      share_url: string;
      file_id: string;
      display_name: string;
      file_id_list: string[];
    }>(API_HOST + "/adrive/v2/share_link/create", body);
    if (r.error) {
      // console.log("[DOMAIN]AliyunDrive - create_shared_resource failed", r.error.message);
      return Result.Err(r.error);
    }
    const { share_url, file_id, display_name } = r.data;
    return Result.Ok({
      share_url,
      file_id,
      file_name: display_name,
    });
  }
  /**
   * 创建快传分享资源
   */
  async create_quick_shared_resource(file_ids: string[]) {
    await this.ensure_initialized();
    const r = await this.request.post<{
      share_url: string;
      file_id: string;
      display_name: string;
    }>(API_HOST + "/adrive/v1/share/create", {
      drive_file_list: file_ids.map((id) => {
        return {
          file_id: id,
          drive_id: String(this.drive_id),
        };
      }),
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok({
      share_url: r.data.share_url,
      file_id: r.data.file_id,
      file_name: r.data.display_name,
    });
  }
  /** 获取快传分享资源 */
  async fetch_quick_shared_resource(url: string) {
    await this.ensure_initialized();
    const matched_share_id = url.match(/\/t\/([a-zA-Z0-9]{1,})$/);
    if (!matched_share_id) {
      return Result.Err("Invalid url, it must includes share_id like 'hFgvpSXzCYd' at the end of url");
    }
    const share_id = matched_share_id[1];
    const r = await this.request.post<{
      share_url: string;
      file_id: string;
      display_name: string;
    }>(API_HOST + `/adrive/v1/share/getByAnonymous?share_id=${share_id}`, {
      share_id,
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(r.data);
  }
  async save_quick_shared_resource(body: { url: string }) {
    await this.ensure_initialized();
    const { url } = body;
    const matched_share_id = url.match(/\/t\/([a-zA-Z0-9]{1,})$/);
    if (!matched_share_id) {
      return Result.Err("Invalid url, it must includes share_id like 'hFgvpSXzCYd' at the end of url");
    }
    const share_id = matched_share_id[1];
    const token_res = await this.request.post<{
      share_token: string;
    }>(API_HOST + "/adrive/v1/share/getShareToken", {
      share_id,
    });
    if (token_res.error) {
      return Result.Err(token_res.error);
    }
    const token = token_res.data.share_token;
    const r = await this.request.post<{
      items: {
        id: string;
        status: number;
        body: {
          domain_id: string;
          drive_id: string;
          file_id: string;
        };
      }[];
      to_drive_id: string;
      to_parent_file_id: string;
    }>(
      API_HOST + "/adrive/v1/share/saveFile",
      {
        share_id,
      },
      {
        "x-share-token": token,
      }
    );
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(r.data);
  }
  /** 将云盘内的文件，移动到另一个云盘 */
  async move_files_to_drive(body: {
    file_ids: string[];
    target_drive_client: AliyunDriveClient;
    target_folder_id: string;
  }) {
    const { file_ids, target_drive_client: other_drive } = body;
    // console.log("[DOMAIN]move_files_to_drive - file_ids is", file_ids);
    const r = await this.create_shared_resource(file_ids);
    if (r.error) {
      return Result.Err(r.error);
    }
    const { share_url, file_id, file_name } = r.data;
    await sleep(file_ids.length * 500);
    const r2 = await other_drive.save_multiple_shared_files({
      url: share_url,
    });
    if (r2.error) {
      return Result.Err(r2.error);
    }
    return Result.Ok({ file_id, file_name });
  }
  /** 将云盘内的文件，移动到另一个云盘 */
  async move_files_to_drive_with_quick(body: {
    file_ids: string[];
    target_drive_client: AliyunDriveClient;
    target_folder_id: string;
  }) {
    const { file_ids, target_drive_client: other_drive } = body;
    const r = await this.create_quick_shared_resource(file_ids);
    if (r.error) {
      return Result.Err(r.error);
    }
    const { share_url, file_id, file_name } = r.data;
    // console.log('share url', share_url);
    const r2 = await other_drive.fetch_quick_shared_resource(share_url);
    if (r2.error) {
      return Result.Err(r2.error);
    }
    const r3 = await other_drive.save_quick_shared_resource({
      url: share_url,
      // file_id,
    });
    if (r3.error) {
      return Result.Err(r3.error);
    }
    return Result.Ok({ file_id, file_name });
  }
  /**
   * 上传文件到云盘前，先调用该方法获取到上传地址
   */
  async create_with_folder(body: {
    content_hash: string;
    name: string;
    parent_file_id: string;
    part_info_list: { part_number: number }[];
    proof_code: string;
    size: number;
  }) {
    await this.ensure_initialized();
    const url = "/adrive/v2/file/createWithFolders";
    const b = {
      ...body,
      content_hash_name: "sha1",
      check_name_mode: "overwrite",
      create_scene: "file_upload",
      proof_version: "v1",
      type: "file",
      device_name: "",
      drive_id: String(this.drive_id),
    };
    const r = await this.request.post<{
      parent_file_id: string;
      part_info_list: {
        part_number: number;
        // 用该地址上传
        upload_url: string;
        internal_upload_url: string;
        content_type: string;
      }[];
      upload_id: string;
      rapid_upload: boolean;
      type: string;
      file_id: string;
      revision_id: string;
      domain_id: string;
      drive_id: string;
      file_name: string;
      encrypt_mode: string;
      location: string;
    }>(API_HOST + url, b);
    if (r.error) {
      return r;
    }
    return Result.Ok(r.data);
  }
  /**
   * 上传一个文件到制定文件夹
   */
  async upload(file_buffer: Buffer, options: { name: string; parent_file_id: string }) {
    await this.ensure_initialized();
    const { name, parent_file_id = "root" } = options;
    const { content_hash, proof_code, size, part_info_list } = await prepare_upload_file(file_buffer, {
      token: this.access_token,
    });
    const r = await this.create_with_folder({
      content_hash,
      proof_code,
      part_info_list,
      size,
      name,
      parent_file_id,
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    if (!r.data.part_info_list?.[0]) {
      return Result.Err("没有上传地址");
    }
    try {
      await axios.put(r.data.part_info_list[0].upload_url, file_buffer, {
        headers: {
          Authorization: this.access_token,
          "Content-Type": "application/octet-stream",
        },
      });
      return Result.Ok({
        file_id: r.data.file_id,
        file_name: r.data.file_name,
      });
    } catch (err) {
      const error = err as AxiosError<{ code: string; message: string }>;
      const { response, message } = error;
      console.log("[]upload failed", message, response?.data);
      return Result.Err(response?.data?.message || message, response?.data?.code);
    }
  }
  async ping() {
    // await this.ensure_initialized();
    const r = await this.request.post(API_HOST + "/adrive/v2/user/get", {});
    if (r.error) {
      return Result.Err(r.error);
    }
    return Result.Ok(null);
  }
  /** 文件移入回收站 */
  async to_trash(file_id: string) {
    await this.ensure_initialized();
    const r = await this.request.post(API_HOST + "/adrive/v2/recyclebin/trash", {
      drive_id: String(this.drive_id),
      file_id,
    });
    if (r.error) {
      return r;
    }
    return Result.Ok(null);
  }
  async fetch_files_in_recycle_bin(body: { next_marker?: string } = {}) {
    const { next_marker } = body;
    await this.ensure_initialized();
    const r = await this.request.post(API_HOST + "/adrive/v2/recyclebin/list", {
      drive_id: String(this.drive_id),
      limit: 20,
      order_by: "name",
      order_direction: "DESC",
    });
    if (r.error) {
      return r;
    }
    return Result.Ok(r.data);
  }
  /** 从回收站删除文件 */
  async delete_file(file_id: string) {
    await this.ensure_initialized();
    const r = await this.request.post(API_HOST + "/v3/file/delete", {
      drive_id: String(this.drive_id),
      file_id,
    });
    if (r.error) {
      return r;
    }
    return Result.Ok(null);
  }
  /**
   * 请求接口时返回了 401，并且还有 refresh_token 时，拿 refresh_token 换 access_token
   * @param token 用来获取新 token 的 refresh_token
   */
  async refresh_aliyun_access_token() {
    // console.log("refresh_aliyun_access_token", this.refresh_token);
    const refresh_token_res = await this.request.post<{
      access_token: string;
      refresh_token: string;
    }>(API_HOST + "/v2/account/token", {
      refresh_token: this.refresh_token,
      grant_type: "refresh_token",
    });
    if (refresh_token_res.error) {
      console.log("refresh token failed, because", refresh_token_res.error.message);
      return Result.Err(refresh_token_res.error);
    }
    const { access_token } = refresh_token_res.data;
    // console.log("refresh token success", access_token);
    this.access_token = access_token;
    const patch_aliyun_drive_token_res = await this.patch_aliyun_drive_token({
      refresh_token: refresh_token_res.data.refresh_token,
      access_token: refresh_token_res.data.access_token,
      expired_at: dayjs().add(5, "minute").unix(),
    });
    if (patch_aliyun_drive_token_res.error) {
      return Result.Err(patch_aliyun_drive_token_res.error);
    }
    return Result.Ok(refresh_token_res.data);
  }
  async create_session() {
    const resp = await this.request.post(API_HOST + "/users/v1/users/device/create_session", {
      utdid: "Y9UzJWvkWRkDAFX691aWX0xS",
      umid: "MNkB2ehLPC8x0xKGZDDP5BZa6pHglCk5",
      deviceName: "iPhone",
      modelName: "iPhone12,3",
      pubKey: PUBLIC_KEY,
      refreshToken: this.refresh_token,
    });
    if (resp.error) {
      console.log("create_session failed, because", resp.error.message);
      return resp;
    }
    return resp;
  }
  async renew_session() {
    const { error, data } = await this.request.post<DriveRecord>(API_HOST + "/users/v1/users/device/renew_session", {});
    if (error) {
      // console.log("[]renew_session failed", error.message);
      return Result.Err(error);
    }
    // console.log("[]renew_session", data);
    return Result.Ok(data);
  }
  async patch_aliyun_drive_token(data: AliyunDriveToken) {
    if (!this.token_id) {
      return Result.Err("请先调用 client.init 方法获取云盘信息");
    }
    const { refresh_token, access_token, expired_at } = data;
    return this.store.update_aliyun_drive_token(this.token_id, {
      data: JSON.stringify({
        refresh_token,
        access_token,
      }),
      expired_at,
    });
  }
  /** 签到 */
  async checked_in() {
    const r = await this.ensure_initialized();
    if (r.error) {
      return Result.Err(r.error);
    }
    const { error, data } = await this.request.post<{
      success: boolean;
      message: string;
      result: {
        subject: string;
      };
    }>(
      MEMBER_API_HOST + "/v1/activity/sign_in_list",
      {
        isReward: true,
      },
      {
        Host: "member.aliyundrive.com",
      }
    );
    if (error) {
      return Result.Err(error);
    }
    const { success, message } = data;
    if (!success) {
      return Result.Err(message);
    }
    return Result.Ok(data);
  }
  /** 获取签到奖励列表 */
  async fetch_rewards() {
    const r = await this.ensure_initialized();
    if (r.error) {
      return Result.Err(r.error);
    }
    const { error, data } = await this.request.post<{
      success: boolean;
      code: null;
      message: string | null;
      totalCount: null;
      nextToken: null;
      maxResults: null;
      result: {
        subject: string;
        title: string;
        description: string;
        isReward: boolean;
        blessing: string;
        signInCount: number;
        signInCover: string;
        signInRemindCover: string;
        rewardCover: string;
        pcAndWebRewardCover: string;
        signInLogs: {
          day: number;
          status: "normal" | "miss";
          icon: string;
          pcAndWebIcon: string;
          notice: null;
          /** 奖品类型 postpone(延期卡) */
          type: "luckyBottle" | "svipVideo" | "svip8t" | "logo" | "postpone";
          rewardAmount: number;
          themes: string;
          calendarChinese: string;
          calendarDay: string;
          calendarMonth: string;
          poster: null;
          reward: {
            goodsId: null;
            name: null;
            description: null;
            background: string;
            color: null;
            action: null;
            detailAction: null;
            notice: null;
            bottleId: null;
            bottleName: null;
          };
          /** 是否领取 true已领取 false未领取 */
          isReward: boolean;
        }[];
      };
      arguments: null;
    }>(
      MEMBER_API_HOST + "/v1/activity/sign_in_list",
      {
        isReward: false,
      },
      {
        Host: "member.aliyundrive.com",
      }
    );
    if (error) {
      return Result.Err(error);
    }
    const { success, message } = data;
    if (!success) {
      return Result.Err(message as string);
    }
    const {
      result: { signInLogs },
    } = data;
    return Result.Ok(
      signInLogs
        .filter((log) => {
          const { status, isReward } = log;
          return isReward === false && status === "normal";
        })
        .map((log) => {
          const { day, type, rewardAmount, isReward } = log;
          return {
            day,
            type,
            rewardAmount,
            isReward,
          };
        })
    );
  }
  /** 领取奖励 */
  async receive_reward(day: number) {
    const r = await this.ensure_initialized();
    if (r.error) {
      return Result.Err(r.error);
    }
    const { error, data } = await this.request.post<{
      success: boolean;
      code: null;
      message: string | null;
      totalCount: null;
      nextToken: null;
      maxResults: null;
      result: {
        goodsId: number;
        name: string;
        description: string;
        background: string;
        color: string;
        action: string;
        detailAction: string;
        notice: string;
        bottleId: null;
        bottleName: null;
      };
      arguments: null;
    }>(
      MEMBER_API_HOST + "/v1/activity/sign_in_reward",
      {
        signInDay: day,
      },
      {
        Host: "member.aliyundrive.com",
      }
    );
    if (error) {
      return Result.Err(error);
    }
    const { success, message } = data;
    if (!success) {
      return Result.Err(message as string);
    }
    const { result } = data;
    return Result.Ok(result);
  }

  on_transfer_failed(handler: Handler<TheTypesOfEvents[Events.TransferFailed]>) {
    return this.on(Events.TransferFailed, handler);
  }
  on_transfer_finish(handler: Handler<TheTypesOfEvents[Events.TransferFinish]>) {
    return this.on(Events.TransferFinish, handler);
  }
  on_print(handler: Handler<TheTypesOfEvents[Events.Print]>) {
    return this.on(Events.Print, handler);
  }
}

function format_M3U8_manifest(videos: PartialVideo[]) {
  const result: {
    name: string;
    width: number;
    height: number;
    type: string;
    url: string;
  }[] = [];
  for (let i = 0; i < videos.length; i += 1) {
    const { url, status, template_id, template_name, template_width, template_height } = videos[i];
    if (status === "finished") {
      result.push({
        name: template_name,
        width: template_width,
        height: template_height,
        type: template_id,
        url,
      });
    }
  }
  return result;
}

// const typeTexts = {
//   luckyBottle: "漂流瓶",
//   svipVideo: "影音VIP",
//   svip8t: "8T VIP",
//   logo: "LOGO",
//   postpone: "延期卡",
// };

function run<T extends (...args: any[]) => Promise<{ error: Error | null; finished: boolean; data: any }>>(
  fn: T,
  options: Partial<{
    timeout: number;
    times: number;
  }> = {}
) {
  const { timeout, times } = options;
  let start = new Date().valueOf();
  function _run<T extends (...args: any[]) => Promise<{ error: Error | null; finished: boolean; data: any }>>(
    fn: T,
    resolve: (data: Unpacked<ReturnType<T>>["data"]) => void
  ) {
    fn().then((res) => {
      if (res.error) {
        resolve(Result.Err(res.error));
        return;
      }
      const now = new Date().valueOf();
      if (timeout !== undefined && now - start >= timeout) {
        resolve(Result.Err(new Error("超时未完成")));
        return;
      }
      if (!res.finished) {
        _run(fn, resolve);
        return;
      }
      resolve(Result.Ok(res.data));
    });
  }
  const p = new Promise((resolve) => {
    _run(fn, resolve);
  }) as Promise<Result<Unpacked<ReturnType<T>>["data"]>>;
  return p;
}

// curl 'https://api.aliyundrive.com/adrive/v2/file/createWithFolders' \
//   -H 'authority: api.aliyundrive.com' \
//   -H 'accept: application/json, text/plain, */*' \
//   -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8' \
//   -H 'authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1NTY1MDQ1ZWVmODQ0NDVjYmRlY2U3OTBhZWJlNTRiZCIsImN1c3RvbUpzb24iOiJ7XCJjbGllbnRJZFwiOlwiMjVkelgzdmJZcWt0Vnh5WFwiLFwiZG9tYWluSWRcIjpcImJqMjlcIixcInNjb3BlXCI6W1wiRFJJVkUuQUxMXCIsXCJTSEFSRS5BTExcIixcIkZJTEUuQUxMXCIsXCJVU0VSLkFMTFwiLFwiVklFVy5BTExcIixcIlNUT1JBR0UuQUxMXCIsXCJTVE9SQUdFRklMRS5MSVNUXCIsXCJCQVRDSFwiLFwiT0FVVEguQUxMXCIsXCJJTUFHRS5BTExcIixcIklOVklURS5BTExcIixcIkFDQ09VTlQuQUxMXCIsXCJTWU5DTUFQUElORy5MSVNUXCIsXCJTWU5DTUFQUElORy5ERUxFVEVcIl0sXCJyb2xlXCI6XCJ1c2VyXCIsXCJyZWZcIjpcImh0dHBzOi8vd3d3LmFsaXl1bmRyaXZlLmNvbS9cIixcImRldmljZV9pZFwiOlwiODhmOTgzNGYzZWE5NGY3MjliMTY0ZThlMTU2NGVjYTNcIn0iLCJleHAiOjE2OTI4MTEwMTEsImlhdCI6MTY5MjgwMzc1MX0.lboIbl1kEPcZ9UwFNsUcwHIh7Bj6fTnyzW8vgc-5Iu91ZzkarKM6VPSoxYMaSJikzGoHQTyz3XNwVrOimS03NeC6ppdC4VoQhbsSBeEM1SDvtAi0Z5p4saurjBEJY1XPekIhjW4u_Cy69UArPaYxrChZDqG6Rf6Fy3refx-3Dw0' \
//   -H 'content-type: application/json' \
//   -H 'origin: https://www.aliyundrive.com' \
//   -H 'referer: https://www.aliyundrive.com/' \
//   -H 'sec-ch-ua: "Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"' \
//   -H 'sec-ch-ua-mobile: ?0' \
//   -H 'sec-ch-ua-platform: "macOS"' \
//   -H 'sec-fetch-dest: empty' \
//   -H 'sec-fetch-mode: cors' \
//   -H 'sec-fetch-site: same-site' \
//   -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' \
//   --data-raw '{"drive_id":"622310670","part_info_list":[{"part_number":1}],"parent_file_id":"root","name":"example01.png","type":"file","check_name_mode":"overwrite","size":4930,"create_scene":"","device_name":"","content_hash":"455FDA33DA839628F1DE6B7929FE3C5B595A69EE","content_hash_name":"sha1","proof_code":"BTLmRomai1Y=","proof_version":"v1"}' \
//   --compressed
