/**
 * @file 管理后台/电视剧详情
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { BaseApiResp } from "@/types";
import { response_error_factory } from "@/utils/backend";
import { store } from "@/store";
import { User } from "@/domains/user";
import { ParsedEpisodeRecord } from "@/domains/store/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { authorization } = req.headers;
  const { tv_id: id } = req.query as Partial<{ tv_id: string }>;
  if (!id || id === "undefined") {
    return e("缺少电视剧 id");
  }
  const t_res = await User.New(authorization, store);
  if (t_res.error) {
    return e(t_res);
  }
  const { id: user_id } = t_res.data;
  const tv = await store.prisma.tv.findFirst({
    where: {
      id,
      user_id,
    },
    include: {
      _count: true,
      profile: true,
      parsed_tvs: {
        orderBy: {
          name: "asc",
        },
      },
      play_histories: {
        include: {
          episode: true,
          member: true,
        },
      },
      seasons: {
        include: {
          profile: true,
          // parsed_season: true,
        },
        orderBy: {
          season_number: "asc",
        },
      },
      episodes: {
        include: {
          parsed_episodes: true,
        },
      },
    },
  });
  if (tv === null) {
    return e("没有匹配的电视剧记录");
  }
  const data = await (async () => {
    const { id, profile, seasons, episodes, parsed_tvs, play_histories, _count } = tv;
    const source_size_count = (() => {
      let size_count = 0;
      const parsed_episodes = episodes.reduce((total, cur) => {
        return total.concat(cur.parsed_episodes);
      }, [] as ParsedEpisodeRecord[]);
      for (let i = 0; i < parsed_episodes.length; i += 1) {
        const parsed_episode = parsed_episodes[i];
        const { size } = parsed_episode;
        size_count += size ?? 0;
      }
      return size_count;
    })();
    const {
      name,
      original_name,
      overview,
      poster_path,
      backdrop_path,
      original_language,
      first_air_date,
      episode_count,
      tmdb_id,
    } = profile;
    const incomplete = episode_count !== 0 && episode_count !== _count.episodes;
    return {
      id,
      name: name || original_name,
      overview,
      poster_path,
      backdrop_path,
      original_language,
      first_air_date,
      tmdb_id,
      size_count: source_size_count,
      incomplete,
      seasons: seasons.map((season) => {
        const { id, season_number, profile } = season;
        const { name, overview } = profile;
        return {
          id,
          name,
          season_number,
          overview,
        };
      }),
      curSeasonEpisodes: await (async () => {
        const firstSeason = seasons[0];
        if (!firstSeason) {
          return [];
        }
        const episodes = await store.prisma.episode.findMany({
          where: {
            tv_id: id,
            season_id: firstSeason.id,
            user_id,
          },
          include: {
            profile: true,
            parsed_episodes: true,
          },
          orderBy: {
            episode_number: "asc",
          },
          take: 20,
        });
        return episodes.map((episode) => {
          const { id, episode_number, profile, parsed_episodes } = episode;
          return {
            id,
            name: profile.name,
            overview: profile.overview,
            episode_number: episode_number,
            first_air_date: profile.air_date,
            sources: parsed_episodes,
          };
        });
      })(),
      parsed_tvs,
      play_histories,
    };
  })();

  res.status(200).json({
    code: 0,
    msg: "",
    data,
  });
}
