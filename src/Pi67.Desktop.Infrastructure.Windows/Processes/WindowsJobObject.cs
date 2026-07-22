using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Pi67.Desktop.Infrastructure.Windows.Processes;

internal sealed partial class WindowsJobObject : IDisposable
{
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;

    private readonly SafeJobHandle handle;

    private WindowsJobObject(SafeJobHandle handle)
    {
        this.handle = handle;
    }

    public static WindowsJobObject CreateKillOnClose()
    {
        SafeJobHandle handle = new(NativeMethods.CreateJobObject(IntPtr.Zero, null), ownsHandle: true);
        if (handle.IsInvalid)
        {
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "Could not create the Pi RPC job object.");
        }

        JobObjectExtendedLimitInformation information = new()
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitKillOnJobClose,
            },
        };

        uint length = checked((uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>());
        if (!NativeMethods.SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformationClass,
                ref information,
                length))
        {
            int error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            throw new Win32Exception(error, "Could not configure the Pi RPC job object.");
        }

        return new WindowsJobObject(handle);
    }

    public void Assign(IntPtr processHandle)
    {
        if (!NativeMethods.AssignProcessToJobObject(handle, processHandle))
        {
            throw new Win32Exception(
                Marshal.GetLastPInvokeError(),
                "Could not attach the Pi RPC process to its job object.");
        }
    }

    public void Terminate(uint exitCode)
    {
        if (!handle.IsInvalid && !NativeMethods.TerminateJobObject(handle, exitCode))
        {
            throw new Win32Exception(
                Marshal.GetLastPInvokeError(),
                "Could not terminate the Pi RPC process tree.");
        }
    }

    public void Dispose() => handle.Dispose();

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal SafeJobHandle(IntPtr preexistingHandle, bool ownsHandle)
            : base(ownsHandle)
        {
            SetHandle(preexistingHandle);
        }

        protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
    }

    private static partial class NativeMethods
    {
        [LibraryImport("kernel32.dll", EntryPoint = "CreateJobObjectW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
        internal static partial IntPtr CreateJobObject(IntPtr jobAttributes, string? name);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static partial bool SetInformationJobObject(
            SafeJobHandle job,
            int informationClass,
            ref JobObjectExtendedLimitInformation information,
            uint informationLength);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static partial bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static partial bool TerminateJobObject(SafeJobHandle job, uint exitCode);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static partial bool CloseHandle(IntPtr handle);
    }
}
