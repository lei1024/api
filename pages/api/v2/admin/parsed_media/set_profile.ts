/**
 * @file 设置未匹配的影视剧详情信息
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { User } from "@/domains/user";
import { MediaSearcher } from "@/domains/searcher/v2";
import { MediaProfileClient } from "@/domains/media_profile";
import { BaseApiResp, Result } from "@/types";
import { MediaTypes } from "@/constants";
import { response_error_factory } from "@/utils/server";
import { app, store } from "@/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { authorization } = req.headers;
  const { parsed_media_id, media_profile } = req.body as Partial<{
    parsed_media_id: string;
    media_profile: {
      id: string;
      type: MediaTypes;
      name: string;
    };
  }>;
  const t_res = await User.New(authorization, store);
  if (t_res.error) {
    return e(t_res);
  }
  const user = t_res.data;
  if (!parsed_media_id) {
    return e(Result.Err("缺少记录 id"));
  }
  if (!media_profile) {
    return e(Result.Err("缺少详情信息"));
  }
  const parsed_media = await store.prisma.parsed_media.findFirst({
    where: {
      id: parsed_media_id,
      user_id: user.id,
    },
    include: {
      parsed_sources: true,
    },
  });
  if (!parsed_media) {
    return e(Result.Err("没有匹配的记录"));
  }
  const profile_r = await (async () => {
    const existing = await store.prisma.media_profile.findFirst({
      where: {
        id: media_profile.id,
        type: media_profile.type,
      },
    });
    if (existing) {
      return Result.Ok(existing);
    }
    const profile_client_res = await MediaProfileClient.New({
      token: user.settings.tmdb_token,
      assets: app.assets,
      store,
    });
    if (profile_client_res.error) {
      return Result.Err(profile_client_res.error.message);
    }
    const profile_client = profile_client_res.data;
    if (media_profile.type === MediaTypes.Movie) {
      return profile_client.cache_movie_profile({ id: media_profile.id });
    }
    if (media_profile.type === MediaTypes.Season) {
      const [series_id, season_number] = media_profile.id.split("/").filter(Boolean).map(Number);
      return profile_client.cache_season_profile({ tv_id: String(series_id), season_number });
    }
    return Result.Err("未知的 type");
  })();
  if (profile_r.error) {
    return e(Result.Err(profile_r.error.message));
  }
  const profile = profile_r.data;
  const searcher_res = await MediaSearcher.New({
    user,
    store,
    assets: app.assets,
  });
  if (searcher_res.error) {
    return e(Result.Err(searcher_res.error.message));
  }
  const searcher = searcher_res.data;
  if (profile.type === MediaTypes.Movie) {
    const media = await searcher.get_movie_media_record_by_profile(profile);
    const updated_parsed_media = await store.prisma.parsed_media.update({
      where: {
        id: parsed_media.id,
      },
      data: {
        type: MediaTypes.Movie,
        media_profile_id: media.profile_id,
      },
      include: {
        media_profile: true,
      },
    });
    for (let i = 0; i < parsed_media.parsed_sources.length; i += 1) {
      const parsed_source = parsed_media.parsed_sources[i];
      await searcher.process_movie_media_source({
        ...parsed_source,
        parsed_media: updated_parsed_media,
      });
    }
    res.status(200).json({ code: 0, msg: "变更详情成功", data: null });
    return;
  }
  if (profile.type === MediaTypes.Season) {
    const media = await searcher.get_season_media_record_by_profile(profile);
    const updated_parsed_media = await store.prisma.parsed_media.update({
      where: {
        id: parsed_media.id,
      },
      data: {
        type: MediaTypes.Season,
        media_profile_id: media.profile_id,
      },
      include: {
        media_profile: true,
      },
    });
    for (let i = 0; i < parsed_media.parsed_sources.length; i += 1) {
      const parsed_source = parsed_media.parsed_sources[i];
      await searcher.process_season_media_source({
        ...parsed_source,
        parsed_media: updated_parsed_media,
      });
    }
    res.status(200).json({ code: 0, msg: "变更详情成功", data: null });
    return;
  }
  return e(Result.Err("未知的 type"));
}
