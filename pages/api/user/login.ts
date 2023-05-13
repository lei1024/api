/**
 * @file 用户登录
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { BaseApiResp } from "@/types";
import { response_error_factory } from "@/utils/backend";
import { User } from "@/domains/user";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BaseApiResp<unknown>>
) {
  const e = response_error_factory(res);
  const { email, password } = req.body as Partial<{
    email: string;
    password: string;
  }>;
  const r = await User.NewWithPassword({ email, password });
  if (r.error) {
    return e(r);
  }
  const { id, token } = r.data;
  return res.status(200).json({
    code: 0,
    msg: "",
    data: {
      id,
      token,
    },
  });
}
