/**
 * @file 新增或更新影片播放记录
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { BaseApiResp } from "@/types";
import {
  parse_token,
  response_error_factory,
  user_id_or_member_id,
} from "@/utils/backend";
import { store } from "@/store";

const { add_history, find_history, update_history } = store;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BaseApiResp<unknown>>
) {
  const e = response_error_factory(res);
  const { authorization } = req.headers;
  const {
    tv_id,
    episode_id,
    current_time = 0,
    duration = 0,
  } = req.body as Partial<{
    tv_id: string;
    episode_id: string;
    current_time: number;
    duration: number;
  }>;
  if (!tv_id) {
    return e("missing tv_id");
  }
  if (!episode_id) {
    return e("missing episode_id");
  }
  const r_token = parse_token(authorization);
  if (r_token.error) {
    return e(r_token);
  }
  const existing_play_resp = await find_history({
    tv_id,
    ...user_id_or_member_id(r_token.data),
  });
  if (existing_play_resp.error) {
    return e(existing_play_resp);
  }
  if (!existing_play_resp.data) {
    const adding_resp = await add_history({
      tv_id,
      episode_id,
      current_time,
      duration,
      ...user_id_or_member_id(r_token.data),
    });
    if (adding_resp.error) {
      return e(adding_resp);
    }
    return res.status(200).json({
      code: 0,
      msg: "",
      data: null,
    });
  }
  const update_resp = await update_history(existing_play_resp.data.id, {
    current_time,
    duration,
    episode_id,
  });
  if (update_resp.error) {
    return e(update_resp);
  }
  res.status(200).json({
    code: 0,
    msg: "",
    data: null,
  });
}
