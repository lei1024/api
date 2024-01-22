/**
 * @file 刷新影视剧详情
 */
import type { NextApiRequest, NextApiResponse } from "next";

import { User } from "@/domains/user";
import { MediaProfileClient } from "@/domains/media_profile";
import { BaseApiResp, Result } from "@/types";
import { response_error_factory } from "@/utils/server";
import { app, store } from "@/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { authorization } = req.headers;
  const { media_id } = req.body as Partial<{ media_id: string }>;
  const t_res = await User.New(authorization, store);
  if (t_res.error) {
    return e(t_res);
  }
  const user = t_res.data;
  if (!media_id) {
    return e(Result.Err("缺少记录 id"));
  }
  const media = await store.prisma.media_profile.findFirst({
    where: {
      id: media_id,
    },
    include: {
      series: true,
    },
  });
  if (media === null) {
    return e(Result.Err("没有匹配的记录"));
  }
  const client_res = await MediaProfileClient.New({
    token: user.settings.tmdb_token,
    assets: app.assets,
    store,
  });
  if (client_res.error) {
    return e(Result.Err(client_res.error.message));
  }
  const client = client_res.data;
  const r = await client.refresh_media_profile_with_tmdb(media);
  if (r.error) {
    return e(Result.Err(r.error.message));
  }
  const r2 = await client.refresh_profile_with_douban(media);
  if (r2.error) {
    return e(Result.Err(r2.error.message));
  }
  res.status(200).json({
    code: 0,
    msg: "更新成功",
    data: null,
  });
}
