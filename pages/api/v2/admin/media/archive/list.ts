/**
 * @file 获取待归档的季列表
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { User } from "@/domains/user";
import { ModelQuery } from "@/domains/store/types";
import { MediaTypes } from "@/constants";
import { BaseApiResp } from "@/types";
import { response_error_factory } from "@/utils/server";
import { store } from "@/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const {
    name,
    type = MediaTypes.Season,
    drive_ids,
    page_size,
    next_marker = "",
  } = req.body as Partial<{
    name: string;
    type: MediaTypes;
    drive_ids: string;
    page_size: number;
    next_marker: string;
  }>;
  const { authorization } = req.headers;
  const t_res = await User.New(authorization, store);
  if (t_res.error) {
    return e(t_res);
  }
  const user = t_res.data;
  let queries: NonNullable<ModelQuery<"media">>[] = [
    {
      type,
      media_sources: {
        every: {
          files: {
            some: drive_ids
              ? {
                  drive_id: {
                    in: drive_ids.split("|"),
                  },
                }
              : {},
          },
        },
      },
      user_id: user.id,
    },
  ];
  if (name) {
    queries.push({
      profile: {
        OR: [
          {
            name: {
              contains: name,
            },
          },
          {
            original_name: {
              contains: name,
            },
          },
          {
            alias: {
              contains: name,
            },
          },
        ],
      },
    });
  }
  const where: ModelQuery<"media"> = {};
  if (queries.length !== 0) {
    where.AND = queries;
  }
  const count = await store.prisma.media.count({
    where,
  });
  const result = await store.list_with_cursor({
    fetch: (args) => {
      return store.prisma.media.findMany({
        where,
        include: {
          _count: true,
          profile: true,
          media_sources: {
            include: {
              profile: true,
              files: {
                include: {
                  drive: true,
                },
                orderBy: {
                  created: "asc",
                },
              },
            },
            orderBy: {
              profile: {
                order: "asc",
              },
            },
          },
        },
        orderBy: {
          profile: { air_date: "asc" },
        },
        ...args,
      });
    },
    page_size,
    next_marker,
  });
  const data = {
    total: count,
    list: result.list.map((media) => {
      const { id, type, profile, media_sources, _count } = media;
      return {
        id,
        type,
        name: profile.name,
        poster_path: profile.poster_path,
        air_date: profile.air_date,
        cur_episode_count: type === MediaTypes.Movie ? null : _count.media_sources,
        episode_count: type === MediaTypes.Movie ? 1 : profile.source_count,
        sources: media_sources.map((source) => {
          const { id, profile, files } = source;
          return {
            id,
            name: profile.name,
            order: type === MediaTypes.Movie ? 1 : source.profile.order,
            files: files.map((file) => {
              const { id, file_id, file_name, parent_paths, size, drive } = file;
              return {
                id,
                file_id,
                file_name,
                parent_paths,
                size,
                drive: {
                  id: drive.id,
                  name: drive.name,
                  type: drive.type,
                },
              };
            }),
          };
        }),
      };
    }),
    page_size,
    next_marker: result.next_marker,
  };
  res.status(200).json({
    code: 0,
    msg: "",
    data,
  });
}
