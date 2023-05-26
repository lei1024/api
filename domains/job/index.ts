import { throttle } from "lodash/fp";
import dayjs from "dayjs";

import { BaseDomain } from "@/domains/base";
import { Article, ArticleLineNode, ArticleTextNode } from "@/domains/article";
import { store, store_factory } from "@/store";
import { AsyncTaskRecord } from "@/store/types";
import { Result } from "@/types";
import { r_id } from "@/utils";

import { TaskStatus } from "./constants";

enum Events {}
type TheTypesOfEvents = {};
type JobProps = {
  id: string;
  profile: Pick<AsyncTaskRecord, "unique_id" | "status" | "created" | "desc" | "user_id" | "output_id">;
  output: Article;
};

export class Job extends BaseDomain<TheTypesOfEvents> {
  static async Get(body: { id: string; user_id: string; store: ReturnType<typeof store_factory> }) {
    const { id, user_id, store } = body;
    const r1 = await store.prisma.async_task.findFirst({
      select: {
        id: true,
        desc: true,
        unique_id: true,
        created: true,
        status: true,
        output: true,
        output_id: true,
      },
      where: {
        id,
        user_id,
      },
    });
    if (!r1) {
      return Result.Err("没有匹配的任务记录");
    }
    const { desc, unique_id, created, status, output_id } = r1;
    const job = new Job({
      id,
      profile: {
        status,
        desc,
        unique_id,
        created,
        user_id,
        output_id,
      },
      output: new Article({}),
    });
    return Result.Ok(job);
  }

  static async New(body: {
    desc: string;
    unique_id: string;
    user_id: string;
    store: ReturnType<typeof store_factory>;
  }) {
    const { desc, unique_id, user_id } = body;
    const existing = await store.prisma.async_task.findFirst({
      where: {
        unique_id,
        status: TaskStatus.Running,
        user_id,
      },
    });
    if (existing) {
      return Result.Err("有运行中的任务", "40001", { job_id: existing.id });
    }
    const res = await store.prisma.async_task.create({
      data: {
        id: r_id(),
        unique_id,
        desc,
        status: TaskStatus.Running,
        output: {
          create: {
            id: r_id(),
            content: "{}",
            user_id,
          },
        },
        user: {
          connect: {
            id: user_id,
          },
        },
      },
    });
    const { id, status, output_id, created } = res;
    const output = new Article({});
    const job = new Job({
      id,
      profile: {
        status,
        desc,
        unique_id,
        created,
        output_id,
        user_id,
      },
      output,
    });
    return Result.Ok(job);
  }

  id: string;
  output: Article;
  profile: JobProps["profile"];

  constructor(options: JobProps) {
    super();

    const { id, profile, output } = options;
    this.id = id;
    this.output = output;
    this.profile = profile;
  }
  /** check need pause the task */
  check_need_pause = throttle(3000, async () => {
    const r = await store.find_task({ id: this.id });
    if (r.error) {
      return Result.Ok(false);
    }
    if (!r.data) {
      return Result.Ok(false);
    }
    const { need_stop } = r.data;
    if (need_stop) {
      return Result.Ok(true);
    }
    return Result.Ok(false);
  });
  async fetch_profile() {
    // return { ...this.profile };
    const r1 = await store.prisma.async_task.findFirst({
      where: {
        id: this.id,
        user_id: this.profile.user_id,
      },
      include: {
        output: true,
      },
    });
    if (!r1) {
      return Result.Err("没有匹配的任务记录");
    }
    const { desc, unique_id, created, status, output } = r1;
    const { content } = output;
    return Result.Ok({
      status,
      desc,
      unique_id,
      created,
      content,
    });
  }
  /** pause the task */
  async pause(options: { force?: boolean } = {}) {
    const { force = false } = options;
    const r = await store.update_task(this.id, {
      need_stop: 1,
      status: force ? TaskStatus.Paused : undefined,
    });
    this.output.write(
      new ArticleLineNode({
        children: [
          new ArticleTextNode({
            text: "主动中止索引任务",
          }),
        ],
      })
    );
    const content = this.output.to_json();
    await store.prisma.output.update({
      where: {
        id: this.profile.output_id,
      },
      data: {
        content: JSON.stringify(content),
      },
    });
  }
  /** tag the task is finished */
  async finish() {
    const r = await store.update_task(this.id, {
      status: TaskStatus.Finished,
    });
    if (r.error) {
      return Result.Err(r.error);
    }
    const content = this.output.to_json();
    await store.prisma.output.update({
      where: {
        id: this.profile.output_id,
      },
      data: {
        content: JSON.stringify(content),
      },
    });
    return Result.Ok(null);
  }
  is_to_long() {
    const { status, created } = this.profile;
    if (status === TaskStatus.Running && dayjs(created).add(15, "minute").isBefore(dayjs())) {
      // this.pause({ force: true });
      // return Result.Ok("任务耗时过长，自动中止");
      return true;
    }
    return false;
  }
}
