using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Windows.ApplicationModel.Resources;
using Pi67.Desktop.Presentation.Shell;

namespace Pi67.Desktop.App.Services;

internal sealed class WinUiShellTextProvider : IShellTextProvider
{
    private readonly ResourceLoader resourceLoader = new();
    private readonly ChineseShellTextProvider fallback = new();

    public string Resolve(string key)
    {
        try
        {
            string value = resourceLoader.GetString(key);
            return string.IsNullOrWhiteSpace(value) ? fallback.Resolve(key) : value;
        }
        catch (COMException)
        {
            return fallback.Resolve(key);
        }
    }

    public string Format(string key, params object?[] arguments) =>
        string.Format(CultureInfo.CurrentCulture, Resolve(key), arguments);
}
