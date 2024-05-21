/**
 * @file 使用微信小程序 code 登录或注册
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { store, BaseApiResp } from "@/store/index";
import { Member } from "@/domains/user/member";
import { Result } from "@/types/index";
import { response_error_factory } from "@/utils/server";
import { AuthenticationProviders } from "@/constants/index";

export default async function v2_wechat_auth_weapp(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { code } = req.body as Partial<{
    code: string;
  }>;
  const administrator = await store.prisma.user.findFirst({});
  if (!administrator) {
    return e(Result.Err("系统异常"));
  }
  const r = await Member.ValidateWithAuthentication(
    {
      provider: AuthenticationProviders.Weapp,
      provider_id: code,
      user_id: administrator.id,
    },
    store
  );
  if (r.error) {
    return e(Result.Err(r.error.message));
  }
  const { id, email, token, permissions } = r.data;
  return res.status(200).json({
    code: 0,
    msg: "登录成功",
    data: {
      id,
      email,
      token,
      permissions,
    },
  });
}
