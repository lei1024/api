/**
 * @file 管理员注册
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { User } from "@/domains/user";
import { BaseApiResp } from "@/types";
import { response_error_factory } from "@/utils/backend";
import { store } from "@/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { email, password } = req.body as Partial<{
    email: string;
    password: string;
  }>;
  const r = await User.Add({ email, password }, store);
  if (r.error) {
    return e(r);
  }
  const { id, token } = r.data;
  return res.status(200).json({
    code: 0,
    msg: "注册成功",
    data: {
      id,
      token,
    },
  });
}
