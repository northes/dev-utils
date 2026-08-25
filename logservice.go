package main

import "log"

// LogService 将前端诊断信息输出到应用终端日志。
type LogService struct{}

func NewLogService() *LogService { return &LogService{} }

func (s *LogService) ServiceName() string { return "LogService" }

func (s *LogService) Log(message string) {
	log.Printf("[frontend] %s", message)
}
