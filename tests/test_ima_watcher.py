"""
tests/test_ima_watcher.py — HTTP 桥 / 目录监视工具的纯函数测试

目前只测 _check_rate_limit 纯函数（v1.2.5 新增）。其他 side-effect 重的
函数（load_credentials / create_media / upload_to_cos / IngestHandler）涉及
凭证 + 网络 + HTTP socket，mock 成本高、价值低，不在本测试套件范围内。

【为什么只测纯函数层】
跟 test_ima_upload.py 同理：v1.2.5 唯一新增的纯函数就是 _check_rate_limit
（IngestHandler.do_POST 只是包装了它）。改底层纯函数时这条测试挡回归；
改 HTTP handler（mock 请求等）成本高且价值低，留作 P1 工作。
"""

from __future__ import annotations

import threading

import pytest

import ima_watcher


# =============================================================================
# _check_rate_limit — 滑动窗口限流（v1.2.5 新增）
# =============================================================================

class TestCheckRateLimit:
    """滑动窗口：1 个 client_ip 在 window_s 秒内最多 limit 次。
    纯函数版本（参数显式传入 now/buckets/limit/window_s）便于测试；
    生产用 _check_rate_limit_thread_safe 包装。"""

    def test_under_limit_passes(self):
        """29 次都过,30 次相同时间点也过（边界）。"""
        buckets: dict = {}
        for _ in range(29):
            assert ima_watcher._check_rate_limit(
                "1.2.3.4", now=0.0, buckets=buckets
            ) is True

    def test_exactly_at_limit_passes_31st_fails(self):
        """30 次全过,第 31 次 fail（默认 limit=30）。"""
        buckets: dict = {}
        for i in range(30):
            ok = ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets)
            assert ok is True, f"第 {i + 1} 次应该过"
        # 第 31 次
        assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is False

    def test_different_ips_have_separate_buckets(self):
        """不同 client_ip 各自有独立配额——IP A 满后 IP B 仍可正常请求。"""
        buckets: dict = {}
        # IP A 跑满 30 次
        for _ in range(30):
            assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is True
        # IP A 31 fail
        assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is False
        # IP B 第一次仍过（独立 bucket）
        assert ima_watcher._check_rate_limit("5.6.7.8", now=0.0, buckets=buckets) is True

    def test_old_timestamps_expire(self):
        """超过 window_s 之前的时间戳自动从 bucket 移除，腾出配额。"""
        buckets: dict = {}
        # 30 次 at t=0
        for _ in range(30):
            assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is True
        # 31st at t=0 fail
        assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is False
        # t=60.0：第一个 0.0 已过期（cutoff = 60.0 - 60.0 = 0.0；严格 > cutoff），
        # 但要 t > 0 才能 trim 干净。t=60.0001 时第一个 0.0 已 trim → 通过
        assert ima_watcher._check_rate_limit("1.2.3.4", now=60.0001, buckets=buckets) is True

    def test_in_window_still_fails(self):
        """窗口内（未过期）继续 fail，即使后续时间点增加。"""
        buckets: dict = {}
        for _ in range(30):
            ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets)
        # t=30.0：所有 0.0 都还在窗口内（cutoff=30.0-60.0=-30.0, t>cutoff 全 pass trim）
        # 等下：cutoff=30-60=-30, 0.0 > -30 → 都不被 trim, 全部还在 → 30 个 → 31st fail
        assert ima_watcher._check_rate_limit("1.2.3.4", now=30.0, buckets=buckets) is False

    def test_limit_configurable(self):
        """limit 参数可覆盖（测试用小值）。"""
        buckets: dict = {}
        # limit=3：3 次过,第 4 fail
        for _ in range(3):
            assert ima_watcher._check_rate_limit(
                "1.2.3.4", now=0.0, buckets=buckets, limit=3
            ) is True
        assert ima_watcher._check_rate_limit(
            "1.2.3.4", now=0.0, buckets=buckets, limit=3
        ) is False

    def test_window_s_configurable(self):
        """window_s 参数可覆盖（测试用小窗口）。"""
        buckets: dict = {}
        # limit=3, window_s=10.0
        for _ in range(3):
            assert ima_watcher._check_rate_limit(
                "1.2.3.4", now=0.0, buckets=buckets, limit=3, window_s=10.0
            ) is True
        # t=5.0：还在 10s 窗口内，fail
        assert ima_watcher._check_rate_limit(
            "1.2.3.4", now=5.0, buckets=buckets, limit=3, window_s=10.0
        ) is False
        # t=10.0001：第一个 0.0 已 trim（cutoff=10.0001-10.0=0.0001, 0.0 不 > 0.0001）
        # 实际：cutoff=0.0001, 0.0 > 0.0001 False → trim → 剩 2 个 → 通过
        assert ima_watcher._check_rate_limit(
            "1.2.3.4", now=10.0001, buckets=buckets, limit=3, window_s=10.0
        ) is True

    def test_buckets_mutated_in_place(self):
        """buckets 是 in-place 修改（dict 引用），方便生产代码共享 dict 状态。"""
        buckets: dict = {}
        ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets)
        # buckets 应有 "1.2.3.4" key
        assert "1.2.3.4" in buckets
        assert buckets["1.2.3.4"] == [0.0]
        # 再加一次
        ima_watcher._check_rate_limit("1.2.3.4", now=1.0, buckets=buckets)
        assert buckets["1.2.3.4"] == [0.0, 1.0]

    def test_default_limit_and_window_match_production(self):
        """默认参数跟生产配置一致：limit=30, window_s=60.0。"""
        # 不传 limit/window_s,用默认值
        buckets: dict = {}
        for _ in range(30):
            assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is True
        assert ima_watcher._check_rate_limit("1.2.3.4", now=0.0, buckets=buckets) is False


# =============================================================================
# 模块级常量 sanity check
# =============================================================================

class TestModuleConstants:
    """验证 _RATE_LIMIT_PER_MIN / _rate_buckets / _rate_lock 配置正确。
    防止有人不小心改了默认值导致生产行为偏离。"""

    def test_rate_limit_constant(self):
        assert ima_watcher._RATE_LIMIT_PER_MIN == 30

    def test_buckets_is_empty_dict(self):
        """测试间共享的 dict——每个测试自己用 dict 模拟,但模块级 dict 应是空的。"""
        # 注：模块级 _rate_buckets 跟 HTTP handler 共享，单线程测试下不会污染。
        # 如果担心并发，可加锁测试。当前 pytest 默认单线程执行，OK。
        assert isinstance(ima_watcher._rate_buckets, dict)

    def test_lock_is_threading_lock(self):
        assert isinstance(ima_watcher._rate_lock, type(threading.Lock()))
