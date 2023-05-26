/**
 * @file 执行指定同步任务
 */
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

import { BaseApiResp } from "@/types";
import { response_error_factory } from "@/utils/backend";
import { User } from "@/domains/user";
import { store } from "@/store";
import { ResourceSyncTask } from "@/domains/resource_sync_task";

export default async function handler(req: NextApiRequest, res: NextApiResponse<BaseApiResp<unknown>>) {
  const e = response_error_factory(res);
  const { authorization } = req.headers;
  const { id } = req.query as Partial<{ id: string }>;
  if (!id) {
    return e("缺少同步任务 id");
  }
  const t_res = await User.New(authorization);
  if (t_res.error) {
    return e(t_res);
  }
  const { id: user_id } = t_res.data;
  const task_res = await ResourceSyncTask.Get({ id, user_id, store });
  if (task_res.error) {
    return e(task_res);
  }
  const task = task_res.data;
  const r = await task.run();
  if (r.error) {
    return e(r);
  }
  const { job_id } = r.data;
  res.status(200).json({ code: 0, msg: "", data: { job_id } });
}
