using System.Runtime.InteropServices;
using Windows.Management.Deployment;

namespace Pi67.Desktop.RuntimeBootstrap;

internal static class Program
{
    private static readonly string[] RuntimePackages =
    [
        "Microsoft.WindowsAppRuntime.2.msix",
        "Microsoft.WindowsAppRuntime.Main.2.msix",
        "Microsoft.WindowsAppRuntime.Singleton.2.msix",
        "Microsoft.WindowsAppRuntime.DDLM.2.msix",
    ];

    public static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19045))
        {
            Console.Error.WriteLine("Pi-67 Desktop requires Windows 10 22H2 build 19045 or newer.");
            return 10;
        }
        if (RuntimeInformation.ProcessArchitecture is not Architecture.X64)
        {
            Console.Error.WriteLine("Pi-67 Desktop runtime bootstrap requires Windows x64.");
            return 11;
        }

        string packageDirectory = args.Length == 0
            ? Path.Combine(AppContext.BaseDirectory, "WinAppRuntime")
            : Path.GetFullPath(args[0]);
        if (!Directory.Exists(packageDirectory))
        {
            Console.Error.WriteLine($"Windows App Runtime payload directory was not found: {packageDirectory}");
            return 12;
        }

        PackageManager manager = new();
        foreach (string packageName in RuntimePackages)
        {
            string packagePath = Path.Combine(packageDirectory, packageName);
            if (!File.Exists(packagePath))
            {
                Console.Error.WriteLine($"Required Windows App Runtime payload was not found: {packageName}");
                return 13;
            }

            try
            {
                DeploymentResult result = await manager.AddPackageAsync(
                    new Uri(packagePath),
                    dependencyPackageUris: null,
                    DeploymentOptions.None);
                Exception? deploymentError = result.ExtendedErrorCode;
                if (deploymentError is not null && !IsAlreadySatisfied(deploymentError.HResult))
                {
                    string detail = string.IsNullOrWhiteSpace(result.ErrorText)
                        ? deploymentError.Message
                        : result.ErrorText;
                    Console.Error.WriteLine($"Failed to install {packageName}: {detail}");
                    return 20;
                }
            }
            catch (COMException exception) when (IsAlreadySatisfied(exception.HResult))
            {
                // A same or newer Microsoft-signed runtime already satisfies the dependency.
            }
            catch (Exception exception) when (exception is COMException or UnauthorizedAccessException)
            {
                Console.Error.WriteLine($"Failed to install {packageName}: {exception.Message}");
                return 20;
            }
        }

        return 0;
    }

    private static bool IsAlreadySatisfied(int hresult) => unchecked((uint)hresult) is
        0x80073CFB or // ERROR_PACKAGE_ALREADY_EXISTS
        0x80073D06;  // ERROR_INSTALL_PACKAGE_DOWNGRADE
}
