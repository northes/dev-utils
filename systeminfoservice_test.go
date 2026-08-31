package main

import (
	"os/exec"
	"runtime"
	"testing"
)

func TestSystemInfoServiceGetSystemInfo(t *testing.T) {
	info := NewSystemInfoService().GetSystemInfo()
	if info.OS == "" {
		t.Fatal("操作系统不应为空")
	}
	if info.Arch == "" {
		t.Fatal("架构不应为空")
	}
	if runtime.GOOS != "darwin" {
		return
	}
	if _, err := exec.Command("sw_vers", "-productVersion").Output(); err != nil {
		t.Skipf("测试环境无法执行 sw_vers: %v", err)
	}
	if info.Version == "" {
		t.Fatal("macOS 版本不应为空")
	}
}
