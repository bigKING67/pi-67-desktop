#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <charconv>
#include <cstdint>
#include <iostream>
#include <string>
#include <string_view>
#include <system_error>

namespace {

constexpr DWORD kTerminationExitCode = 70;
constexpr DWORD kTerminationPollIntervalMs = 10;
constexpr DWORD kTerminationWaitMs = 1500;

class UniqueHandle {
 public:
  explicit UniqueHandle(HANDLE handle = nullptr) : handle_(handle) {}
  ~UniqueHandle() {
    if (handle_ != nullptr) CloseHandle(handle_);
  }

  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;

  HANDLE get() const { return handle_; }

 private:
  HANDLE handle_;
};

void WriteError(std::string_view operation, DWORD code) {
  std::cout << "{\"type\":\"error\",\"operation\":\"" << operation
            << "\",\"code\":" << code << "}" << std::endl;
}

bool QueryActiveProcesses(HANDLE job, DWORD* active_processes) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr)) {
    WriteError("query", GetLastError());
    return false;
  }
  *active_processes = accounting.ActiveProcesses;
  return true;
}

bool WriteStatus(HANDLE job, std::string_view type) {
  DWORD active_processes = 0;
  if (!QueryActiveProcesses(job, &active_processes)) return false;
  std::cout << "{\"type\":\"" << type << "\",\"activeProcesses\":"
            << active_processes << "}" << std::endl;
  return std::cout.good();
}

bool WaitForTerminated(HANDLE job) {
  const ULONGLONG deadline = GetTickCount64() + kTerminationWaitMs;
  while (true) {
    DWORD active_processes = 0;
    if (!QueryActiveProcesses(job, &active_processes)) return false;
    if (active_processes == 0) {
      std::cout << "{\"type\":\"terminated\",\"activeProcesses\":0}" << std::endl;
      return std::cout.good();
    }
    if (GetTickCount64() >= deadline) {
      WriteError("terminate-timeout", WAIT_TIMEOUT);
      return false;
    }
    Sleep(kTerminationPollIntervalMs);
  }
}

bool ParseProcessId(const char* value, DWORD* process_id) {
  std::string_view input(value == nullptr ? "" : value);
  std::uint64_t parsed = 0;
  const auto result = std::from_chars(input.data(), input.data() + input.size(), parsed);
  if (result.ec != std::errc{} || result.ptr != input.data() + input.size() ||
      parsed == 0 || parsed > MAXDWORD) {
    return false;
  }
  *process_id = static_cast<DWORD>(parsed);
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3 || std::string_view(argv[1]) != "--pid") {
    WriteError("arguments", ERROR_INVALID_PARAMETER);
    return 64;
  }

  DWORD process_id = 0;
  if (!ParseProcessId(argv[2], &process_id)) {
    WriteError("pid", ERROR_INVALID_PARAMETER);
    return 64;
  }

  UniqueHandle job(CreateJobObjectW(nullptr, nullptr));
  if (job.get() == nullptr) {
    WriteError("create-job", GetLastError());
    return 70;
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) {
    WriteError("configure-job", GetLastError());
    return 70;
  }

  UniqueHandle process(OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE |
                                       PROCESS_QUERY_LIMITED_INFORMATION,
                                   FALSE, process_id));
  if (process.get() == nullptr) {
    WriteError("open-process", GetLastError());
    return 70;
  }
  if (!AssignProcessToJobObject(job.get(), process.get())) {
    WriteError("assign-process", GetLastError());
    return 70;
  }
  if (!WriteStatus(job.get(), "ready")) return 70;

  std::string command;
  while (std::getline(std::cin, command)) {
    if (command == "inspect") {
      if (!WriteStatus(job.get(), "status")) return 70;
      continue;
    }
    if (command == "terminate") {
      if (!TerminateJobObject(job.get(), kTerminationExitCode)) {
        WriteError("terminate", GetLastError());
        return 70;
      }
      if (!WaitForTerminated(job.get())) return 70;
      continue;
    }
    if (command == "close") {
      if (!WriteStatus(job.get(), "closing")) return 70;
      return 0;
    }
    WriteError("command", ERROR_INVALID_PARAMETER);
    return 64;
  }

  // Closing a configured Job handle is the final containment fallback.
  return 0;
}
